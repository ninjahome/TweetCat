import {
    decryptSettingsForUI,
    IpfsProvider,
    IpfsSettings,
    loadIpfsSettings, PROVIDER_TYPE_CUSTOM,
    PROVIDER_TYPE_LIGHTHOUSE, PROVIDER_TYPE_PINATA,
    PROVIDER_TYPE_TWEETCAT, saveIpfsSettings
} from "../wallet/ipfs_settings";
import {EncryptedBlock, encryptString, showView} from "../common/utils";
import {$, $Id, $input, showNotification} from "./common";
import {t} from "../common/i18n";
import {requestPassword} from "./password_modal";
import {resetIpfsClient} from "../wallet/ipfs_api";
import {dashRouter} from "./dashboard";

type PendingField = { label: string; value: string; apply: (block: EncryptedBlock) => void; };

let currentIpfsSettings: IpfsSettings | null = null;

function getSelectedProvider(): IpfsProvider {
    const sel = $Id('ipfs-provider-select') as HTMLSelectElement;
    return (sel?.value as IpfsProvider) || PROVIDER_TYPE_TWEETCAT;
}

function setSelectedProvider(provider: IpfsProvider): void {
    const sel = $Id('ipfs-provider-select') as HTMLSelectElement;
    if (sel) {
        sel.value = provider;
    }
}

function updateProviderVisibility(): void {
    const provider = getSelectedProvider();
    document.querySelectorAll<HTMLElement>('.ipfs-provider-section').forEach(section => {
        const sectionProvider = section.dataset.provider as IpfsProvider | undefined;
        section.hidden = !!sectionProvider && sectionProvider !== provider;
    });

    const sel = $Id('ipfs-provider-set-tweetcat');
    if (provider === PROVIDER_TYPE_TWEETCAT) {
        sel.classList.add("is-default")
    } else {
        sel.classList.remove("is-default")
    }
}

function setSensitiveState(input: HTMLInputElement | null, hasValue: boolean): void {
    if (!input) return;

    // 记住初始 placeholder，方便恢复
    if (!input.dataset.defaultPlaceholder) {
        input.dataset.defaultPlaceholder = input.placeholder ?? "";
    }

    input.dataset.hasValue = hasValue ? "1" : "0";

    if (hasValue) {
        input.value = "";
        input.placeholder = t('key_tips_has_set');
        input.readOnly = true;
        input.type = "password";
        input.classList.add("has-secret", "secret-readonly");
    } else {
        input.value = "";
        input.placeholder = input.dataset.defaultPlaceholder ?? "";
        input.readOnly = false;
        input.classList.remove("secret-readonly");
    }
}

function scheduleSensitive(
    input: HTMLInputElement | null,
    existing: EncryptedBlock | undefined,
    label: string,
    assign: (block: EncryptedBlock | undefined) => void,
    pending: PendingField[],
): void {
    if (!input) {
        assign(existing);
        return;
    }
    const value = input.value.trim();
    const hasExisting = input.dataset.hasValue === '1' && !!existing;
    if (value) {
        pending.push({
            label,
            value,
            apply: (block) => assign(block),
        });
    } else if (hasExisting) {
        assign(existing);
    } else {
        assign(undefined);
    }
}

async function fillIpfsForm(): Promise<void> {
    currentIpfsSettings = await loadIpfsSettings();
    const provider = currentIpfsSettings?.provider ?? PROVIDER_TYPE_TWEETCAT;
    setSelectedProvider(provider);
    updateProviderVisibility();
    refreshSensitiveIndicators();
}

async function handleIpfsSave(): Promise<boolean> {
    try {
        const provider = getSelectedProvider();
        const pending: PendingField[] = [];
        const next: IpfsSettings = {
            id: 'ipfs',
            provider,
            pinata: currentIpfsSettings?.pinata ? {...currentIpfsSettings.pinata} : undefined,
            lighthouse: currentIpfsSettings?.lighthouse ? {...currentIpfsSettings.lighthouse} : undefined,
            custom: currentIpfsSettings?.custom ? {...currentIpfsSettings.custom} : undefined,
        };

        if (provider === PROVIDER_TYPE_PINATA) {
            const pinata: NonNullable<IpfsSettings[typeof PROVIDER_TYPE_PINATA]> = {};
            scheduleSensitive($input('#pinata-jwt'), currentIpfsSettings?.pinata?.jwtEnc, 'Pinata JWT', block => {
                if (block) pinata.jwtEnc = block; else delete pinata.jwtEnc;
            }, pending);
            scheduleSensitive($input('#pinata-api-key'), currentIpfsSettings?.pinata?.apiKeyEnc, 'Pinata API Key', block => {
                if (block) pinata.apiKeyEnc = block; else delete pinata.apiKeyEnc;
            }, pending);
            scheduleSensitive($input('#pinata-api-secret'), currentIpfsSettings?.pinata?.secretEnc, 'Pinata API Secret', block => {
                if (block) pinata.secretEnc = block; else delete pinata.secretEnc;
            }, pending);
            next.pinata = pinata;
        } else if (provider === PROVIDER_TYPE_LIGHTHOUSE) {
            const lighthouse: NonNullable<IpfsSettings[typeof PROVIDER_TYPE_LIGHTHOUSE]> = {};
            scheduleSensitive($input('#lighthouse-jwt'), currentIpfsSettings?.lighthouse?.jwtEnc, 'Lighthouse JWT', block => {
                if (block) lighthouse.jwtEnc = block; else delete lighthouse.jwtEnc;
            }, pending);
            scheduleSensitive($input('#lighthouse-api-key'), currentIpfsSettings?.lighthouse?.apiKeyEnc, 'Lighthouse API Key', block => {
                if (block) lighthouse.apiKeyEnc = block; else delete lighthouse.apiKeyEnc;
            }, pending);
            next.lighthouse = lighthouse;
        } else if (provider === PROVIDER_TYPE_CUSTOM) {
            const apiUrl = $input('#custom-api-url')?.value.trim() ?? '';
            if (!apiUrl) {
                showNotification(t('ipfs_error_custom_api_url_required'), 'error');
                return false;
            }
            const gatewayUrl = $input('#custom-gateway-url')?.value.trim() ?? '';
            const custom: NonNullable<IpfsSettings[typeof PROVIDER_TYPE_CUSTOM]> = {
                apiUrl,
                gatewayUrl: gatewayUrl || undefined
            };
            scheduleSensitive($input('#custom-auth'), currentIpfsSettings?.custom?.authEnc, '自建节点 Authorization', block => {
                if (block) custom.authEnc = block; else delete custom.authEnc;
            }, pending);
            next.custom = custom;
        }

        let password = '';
        if (pending.length > 0) {
            password = await requestPassword(t('ipfs_prompt_encrypt_password'));
        }
        for (const task of pending) {
            const block = await encryptString(task.value, password);
            task.apply(block);
        }

        if (provider === PROVIDER_TYPE_PINATA) {
            const p = next.pinata ?? {};
            const hasJwt = !!p.jwtEnc;
            const hasKeyPair = !!p.apiKeyEnc && !!p.secretEnc;
            if (!hasJwt && !hasKeyPair) {
                showNotification(t('ipfs_error_pinata_jwt_or_key_required'), 'error');
                return false;
            }
        } else if (provider === PROVIDER_TYPE_LIGHTHOUSE) {
            const l = next.lighthouse ?? {};
            if (!l.jwtEnc && !l.apiKeyEnc) {
                showNotification(t('ipfs_error_lighthouse_api_or_jwt_required'), 'error');
                return false;
            }
        } else if (provider === PROVIDER_TYPE_CUSTOM) {
            if (!next.custom?.apiUrl) {
                showNotification(t('ipfs_error_custom_api_url_required'), 'error');
                return false;
            }
        }

        await saveIpfsSettings(next);
        resetIpfsClient();
        currentIpfsSettings = next;
        showNotification(t('ipfs_save_encrypted_success'), 'info');
        return true;
    } catch (error) {
        const message = (error as Error).message ?? t('ipfs_save_failed');
        showNotification(message, 'error');
        return false;
    }
}

export function initIpfsSettingsView() {
    const ipfsTitle = $Id('ipfs-settings-title');
    if (ipfsTitle) ipfsTitle.textContent = t('ipfs_settings_title');

    const backBtn = $Id('ipfs-back-btn') as HTMLButtonElement | null;
    if (backBtn) {
        const backLabel = t('back');
        backBtn.setAttribute('aria-label', backLabel);
        const backSvg = backBtn.querySelector('svg');
        if (backSvg) {
            backSvg.setAttribute('title', backLabel);
            backSvg.setAttribute('aria-label', backLabel);
        }

        backBtn.addEventListener("click", async () => {
            await saveProviderOnly();
            showView('#onboarding/main-home', dashRouter);
        });
    }

    const providerSelect = $Id('ipfs-provider-select') as HTMLSelectElement | null;
    if (providerSelect) {
        const optPinata = $Id('ipfs-provider-option-pinata');
        if (optPinata) optPinata.textContent = t('ipfs_provider_pinata_option');
        const optLighthouse = $Id('ipfs-provider-option-lighthouse');
        if (optLighthouse) optLighthouse.textContent = t('ipfs_provider_lighthouse_option');
        const optCustom = $Id('ipfs-provider-option-custom');
        if (optCustom) optCustom.textContent = t('ipfs_provider_custom_option');
        const optTweetcat = $Id('ipfs-provider-option-tweetcat');
        if (optTweetcat) optTweetcat.textContent = t('ipfs_provider_tweetcat_option');

        providerSelect.addEventListener('change', () => {
            const value = providerSelect.value as IpfsProvider;
            if (currentIpfsSettings) {
                currentIpfsSettings = {
                    ...currentIpfsSettings,
                    provider: value,
                };
            }
            updateProviderVisibility();
            refreshSensitiveIndicators();
        });
    }

    const sensitiveHint = $Id('ipfs-sensitive-hint');
    if (sensitiveHint) sensitiveHint.textContent = t('ipfs_sensitive_hint');

    const pinataTitle = $Id('ipfs-pinata-section-title');
    if (pinataTitle) pinataTitle.textContent = t('ipfs_pinata_section_title');

    const lighthouseTitle = $Id('ipfs-lighthouse-section-title');
    if (lighthouseTitle) lighthouseTitle.textContent = t('ipfs_lighthouse_section_title');

    const customTitle = $Id('ipfs-custom-section-title');
    if (customTitle) customTitle.textContent = t('ipfs_custom_section_title');

    const linkPinata = $Id('ipfs-link-pinata');
    if (linkPinata) linkPinata.textContent = t('ipfs_link_pinata');

    const linkLighthouse = $Id('ipfs-link-lighthouse');
    if (linkLighthouse) linkLighthouse.textContent = t('ipfs_link_lighthouse');

    const linkDesktop = $Id('ipfs-link-desktop');
    if (linkDesktop) linkDesktop.textContent = t('ipfs_link_desktop');

    const pinataApiKeyLabel = $Id('pinata-api-key-label');
    if (pinataApiKeyLabel) pinataApiKeyLabel.textContent = t('ipfs_pinata_api_key_label');
    const pinataApiKeyInput = $input('#pinata-api-key');
    if (pinataApiKeyInput) pinataApiKeyInput.placeholder = t('ipfs_pinata_api_key_placeholder');

    const pinataSecretLabel = $Id('pinata-api-secret-label');
    if (pinataSecretLabel) pinataSecretLabel.textContent = t('ipfs_pinata_secret_key_label');
    const pinataSecretInput = $input('#pinata-api-secret');
    if (pinataSecretInput) pinataSecretInput.placeholder = t('ipfs_pinata_secret_key_placeholder');

    const pinataJwtLabel = $Id('pinata-jwt-label');
    if (pinataJwtLabel) pinataJwtLabel.textContent = t('ipfs_pinata_jwt_label');
    const pinataJwtInput = $input('#pinata-jwt');
    if (pinataJwtInput) pinataJwtInput.placeholder = t('ipfs_pinata_jwt_placeholder');

    // Lighthouse 表单
    const lighthouseApiKeyLabel = $Id('lighthouse-api-key-label');
    if (lighthouseApiKeyLabel) lighthouseApiKeyLabel.textContent = t('ipfs_lighthouse_api_key_label');
    const lighthouseApiKeyInput = $input('#lighthouse-api-key');
    if (lighthouseApiKeyInput) lighthouseApiKeyInput.placeholder = t('ipfs_lighthouse_api_key_placeholder');

    const lighthouseJwtLabel = $Id('lighthouse-jwt-label');
    if (lighthouseJwtLabel) lighthouseJwtLabel.textContent = t('ipfs_lighthouse_jwt_label');
    const lighthouseJwtInput = $input('#lighthouse-jwt');
    if (lighthouseJwtInput) lighthouseJwtInput.placeholder = t('ipfs_lighthouse_jwt_placeholder');

    const customApiUrlLabel = $Id('custom-api-url-label');
    if (customApiUrlLabel) customApiUrlLabel.textContent = t('ipfs_custom_api_url_label');
    const customApiUrlInput = $input('#custom-api-url');
    if (customApiUrlInput) customApiUrlInput.placeholder = t('ipfs_custom_api_url_placeholder');

    const customGatewayLabel = $Id('custom-gateway-url-label');
    if (customGatewayLabel) customGatewayLabel.textContent = t('ipfs_custom_gateway_url_label');
    const customGatewayInput = $input('#custom-gateway-url');
    if (customGatewayInput) customGatewayInput.placeholder = t('ipfs_custom_gateway_url_placeholder');

    const customAuthLabel = $Id('custom-auth-label');
    if (customAuthLabel) customAuthLabel.textContent = t('ipfs_custom_auth_label');
    const customAuthInput = $input('#custom-auth');
    if (customAuthInput) customAuthInput.placeholder = t('ipfs_custom_auth_placeholder');

    // 打开视图
    $(".ipfs-settings-btn")?.addEventListener("click", async () => {
        await fillIpfsForm();
        showView('#onboarding/ipfs-settings', dashRouter);
    });

    const set_default_node = $Id('ipfs-provider-set-tweetcat');
    set_default_node.textContent = t("use_office_ipfs_node")
    set_default_node?.addEventListener('click', () => {
        setTweetcatAsDefault().then();
    });
    const default_node_noti = $Id('tweetcat-node-notification')
    default_node_noti.textContent = t('default_node_noti')

    const pinata_decrypt_btn = $Id('pinata-reveal-fill')
    pinata_decrypt_btn.textContent = t("decrypt_config")
    pinata_decrypt_btn?.addEventListener('click', () => {
        revealAndFill(PROVIDER_TYPE_PINATA).then();
    });
    const pinata_save_btn = $Id('pinata-save')
    pinata_save_btn.textContent = t("save_config")
    pinata_save_btn?.addEventListener('click', () => {
        saveProviderSecrets(PROVIDER_TYPE_PINATA).then();
    });
    const pinata_clean_btn = $Id('pinata-clear')
    pinata_clean_btn.textContent = t("clean_config")
    pinata_clean_btn?.addEventListener('click', () => {
        clearProviderSecrets(PROVIDER_TYPE_PINATA).then();
    });

    const lighthouse_decrypt_btn = $Id('lighthouse-reveal-fill')
    lighthouse_decrypt_btn.textContent = t("decrypt_config")
    lighthouse_decrypt_btn?.addEventListener('click', () => {
        revealAndFill(PROVIDER_TYPE_LIGHTHOUSE).then();
    });
    const lighthouse_save_btn = $Id('lighthouse-save')
    lighthouse_save_btn.textContent = t("save_config")
    lighthouse_save_btn?.addEventListener('click', () => {
        saveProviderSecrets(PROVIDER_TYPE_LIGHTHOUSE).then();
    });
    const lighthouse_clean_btn = $Id('lighthouse-clear')
    lighthouse_clean_btn.textContent = t("clean_config")
    lighthouse_clean_btn?.addEventListener('click', () => {
        clearProviderSecrets(PROVIDER_TYPE_LIGHTHOUSE).then();
    });

    const custom_decrypt_btn = $Id('custom-reveal-fill')
    custom_decrypt_btn.textContent = t("decrypt_config")
    custom_decrypt_btn?.addEventListener('click', () => {
        revealAndFill(PROVIDER_TYPE_CUSTOM).then();
    });
    const custom_save_btn = $Id('custom-save')
    custom_save_btn.textContent = t("save_config")
    custom_save_btn?.addEventListener('click', () => {
        saveProviderSecrets(PROVIDER_TYPE_CUSTOM).then();
    });
    const custom_clean_btn = $Id('custom-clear')
    custom_clean_btn.textContent = t("clean_config")
    custom_clean_btn?.addEventListener('click', () => {
        clearProviderSecrets(PROVIDER_TYPE_CUSTOM).then();
    });

    document.querySelectorAll<HTMLElement>('[data-ipfs-link]').forEach(btn => {
        btn.addEventListener('click', (ev) => {
            const url = (ev.currentTarget as HTMLElement).getAttribute('data-ipfs-link');
            if (url) window.open(url, '_blank');
        });
    });

    updateProviderVisibility();

    initSecretToggleButtons();
}

function refreshSensitiveIndicators(): void {
    const pinata = currentIpfsSettings?.pinata;
    setSensitiveState($input('#pinata-api-key'), !!pinata?.apiKeyEnc);
    setSensitiveState($input('#pinata-api-secret'), !!pinata?.secretEnc);
    setSensitiveState($input('#pinata-jwt'), !!pinata?.jwtEnc);

    const lighthouse = currentIpfsSettings?.lighthouse;
    setSensitiveState($input('#lighthouse-api-key'), !!lighthouse?.apiKeyEnc);
    setSensitiveState($input('#lighthouse-jwt'), !!lighthouse?.jwtEnc);

    const custom = currentIpfsSettings?.custom;
    setSensitiveState($input('#custom-auth'), !!custom?.authEnc);

    // 同时顺手刷一下自建节点的非加密字段
    const apiUrlInput = $input('#custom-api-url');
    if (apiUrlInput) apiUrlInput.value = custom?.apiUrl ?? '';

    const gatewayInput = $input('#custom-gateway-url');
    if (gatewayInput) gatewayInput.value = custom?.gatewayUrl ?? '';
}

function hasEncryptedSecretsFor(provider: IpfsProvider, saved: IpfsSettings): boolean {
    if (provider === PROVIDER_TYPE_PINATA) {
        return !!(saved.pinata?.jwtEnc || saved.pinata?.apiKeyEnc || saved.pinata?.secretEnc);
    }
    if (provider === PROVIDER_TYPE_LIGHTHOUSE) {
        return !!(saved.lighthouse?.jwtEnc || saved.lighthouse?.apiKeyEnc);
    }
    if (provider === PROVIDER_TYPE_CUSTOM) {
        return !!saved.custom?.authEnc;
    }
    return false;
}

async function setTweetcatAsDefault(): Promise<void> {
    const saved = currentIpfsSettings ?? await loadIpfsSettings();
    const next: IpfsSettings = {
        id: 'ipfs',
        provider: PROVIDER_TYPE_TWEETCAT,
        pinata: saved?.pinata,
        lighthouse: saved?.lighthouse,
        custom: saved?.custom,
    };
    await saveIpfsSettings(next);
    currentIpfsSettings = next;
    setSelectedProvider(PROVIDER_TYPE_TWEETCAT);
    updateProviderVisibility();
    showNotification(t('ipfs_set_tweetcat_default_success'));
}

function fillPlain(selector: string, value: string | undefined) {
    if (!value) return;
    const el = $input(selector);
    if (!el) return;

    el.value = value;
    el.dataset.hasValue = '1';
    el.readOnly = false;
    el.classList.remove('secret-readonly');
}

async function revealAndFill(provider: IpfsProvider): Promise<void> {
    try {

        const savedRaw = currentIpfsSettings ?? await loadIpfsSettings();
        if (!savedRaw) {
            showNotification(t('ipfs_no_saved_settings'), 'info');
            return;
        }
        if (provider === PROVIDER_TYPE_TWEETCAT) {
            showNotification(t('ipfs_tweetcat_no_sensitive_config'), 'info');
            return;
        }

        if (!hasEncryptedSecretsFor(provider, savedRaw)) {
            showNotification(t('ipfs_provider_no_encrypted_fields'), 'info');
            return;
        }

        const password = await requestPassword(t('ipfs_prompt_decrypt_password'));
        const savedForProvider: IpfsSettings = {
            ...savedRaw,
            provider,
        };
        const dec = await decryptSettingsForUI(savedForProvider, password);

        if (provider === PROVIDER_TYPE_PINATA && dec.pinata) {
            fillPlain('#pinata-api-key', dec.pinata.apiKey);
            fillPlain('#pinata-api-secret', dec.pinata.secret);
            fillPlain('#pinata-jwt', dec.pinata.jwt);
        } else if (provider === PROVIDER_TYPE_LIGHTHOUSE && dec.lighthouse) {
            fillPlain('#lighthouse-api-key', dec.lighthouse.apiKey);
            fillPlain('#lighthouse-jwt', dec.lighthouse.jwt);
        } else if (provider === PROVIDER_TYPE_CUSTOM && dec.custom) {
            fillPlain('#custom-auth', dec.custom.auth);
        }

        showNotification(t('decrypt_info_success'), 'info');
    } catch (e) {
        showNotification(t("decrypt_info_failed") + e.toString(), 'error')
    }
}

async function saveProviderSecrets(_provider: IpfsProvider): Promise<void> {
    await handleIpfsSave(); // 当前分区就是当前 provider，直接保存分支即可
}

async function clearProviderSecrets(provider: IpfsProvider): Promise<void> {
    if (!window.confirm(t('ipfs_confirm_clear_provider_secrets'))) return;

    const saved = currentIpfsSettings ?? await loadIpfsSettings();
    if (!saved) {
        showNotification(t('ipfs_no_saved_settings'), 'info');
        return;
    }

    const next: IpfsSettings = {
        ...saved,
        pinata: saved.pinata ? {...saved.pinata} : undefined,
        lighthouse: saved.lighthouse ? {...saved.lighthouse} : undefined,
        custom: saved.custom ? {...saved.custom} : undefined,
    };

    if (provider === PROVIDER_TYPE_PINATA) {
        if (next.pinata) {
            delete next.pinata.apiKeyEnc;
            delete next.pinata.secretEnc;
            delete next.pinata.jwtEnc;
        }
    } else if (provider === PROVIDER_TYPE_LIGHTHOUSE) {
        if (next.lighthouse) {
            delete next.lighthouse.apiKeyEnc;
            delete next.lighthouse.jwtEnc;
        }
    } else if (provider === PROVIDER_TYPE_CUSTOM) {
        if (next.custom) {
            delete next.custom.authEnc;
        }
    } else {
        showNotification(t('ipfs_tweetcat_no_need_clear'), 'info');
        return;
    }

    await saveIpfsSettings(next);
    currentIpfsSettings = next;

    // 清空输入框显示 & 提示
    if (provider === PROVIDER_TYPE_PINATA) {
        ['#pinata-api-key', '#pinata-api-secret', '#pinata-jwt'].forEach(sel => {
            const el = $input(sel);
            if (el) {
                el.value = '';
                el.dataset.hasValue = '0';
            }
        });
    } else if (provider === PROVIDER_TYPE_LIGHTHOUSE) {
        ['#lighthouse-api-key', '#lighthouse-jwt'].forEach(sel => {
            const el = $input(sel);
            if (el) {
                el.value = '';
                el.dataset.hasValue = '0';
            }
        });
    } else if (provider === PROVIDER_TYPE_CUSTOM) {
        const el = $input('#custom-auth');
        if (el) {
            el.value = '';
            el.dataset.hasValue = '0';
        }
    }

    refreshSensitiveIndicators();
    showNotification(t('ipfs_clear_provider_secrets_success'));
}

async function saveProviderOnly(): Promise<void> {
    const selected = getSelectedProvider();
    const saved = currentIpfsSettings ?? await loadIpfsSettings();
    const next: IpfsSettings = {
        id: 'ipfs',
        provider: selected,       // 只改这个字段
        pinata: saved?.pinata,    // 其余保持原样，不改动、不校验
        lighthouse: saved?.lighthouse,
        custom: saved?.custom,
    };
    await saveIpfsSettings(next);
    currentIpfsSettings = next;
    showNotification(t('ipfs_save_default_provider_success'));
}

function initSecretToggleButtons(): void {
    document.querySelectorAll<HTMLButtonElement>('.secret-toggle').forEach(btn => {
        const selector = btn.dataset.secretTarget;
        if (!selector) return;
        const input = $input(selector);
        if (!input) return;

        btn.addEventListener('click', () => {
            // 未解密但已设置时（只读 + 无 value），不允许直接点眼睛看
            if (input.readOnly && input.dataset.hasValue === '1' && !input.value) {
                showNotification(t('ipfs_info_click_decrypt_first'), 'info');
                return;
            }

            input.type = input.type === 'password' ? 'text' : 'password';
            btn.classList.toggle('is-visible', input.type === 'text');
        });
    });
}
