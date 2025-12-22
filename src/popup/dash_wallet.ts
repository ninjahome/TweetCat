import {$Id, $input, hideLoading, showLoading, showNotification} from "./common";
import {t} from "../common/i18n";
import {showView} from "../common/utils";
import {dashRouter} from "./dashboard";
import browser from "webextension-polyfill";
import {defaultWalletSettings, loadWalletSettings, saveWalletSettings, WalletSettings} from "../wallet/wallet_setting";
import {BASE_MAINNET_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID} from "../common/consts";
import {doSignOut, tryGetSignedInUser} from "../common/x402_obj";
import {queryWalletBalance} from "../wallet/cdp_wallet";
import {isAddress} from "viem";

type UiNetworkOption = "base-mainnet" | "base-sepolia";

let currentAddress: string | null = null;
let currentSettings: WalletSettings = {...defaultWalletSettings};

function getChainId(settings: WalletSettings): number {
    return settings.network === "base-mainnet"
        ? BASE_MAINNET_CHAIN_ID
        : BASE_SEPOLIA_CHAIN_ID;
}

function getReadableNetworkName(): string {
    if (currentSettings.network === "base-mainnet") {
        return t("wallet_network_option_base_mainnet");
    }
    return t("wallet_network_option_base_sepolia");
}

function getCurrentEthBalanceText(): string {
    const span = document.querySelector<HTMLSpanElement>(".wallet-eth-value");
    return span?.textContent?.trim() || "--";
}

function getCurrentTokenBalanceText(): string {
    const span = document.querySelector<HTMLSpanElement>(".wallet-usdt-value");
    return span?.textContent?.trim() || "--";
}

async function refreshBalances(showStatus = true): Promise<void> {
    const ethSpan = document.querySelector(".wallet-eth-value") as HTMLSpanElement | null;
    const usdtSpan = document.querySelector(".wallet-usdt-value") as HTMLSpanElement | null;

    if (!currentAddress) {
        if (ethSpan) ethSpan.textContent = "--";
        if (usdtSpan) usdtSpan.textContent = "--";
        if (showStatus) showNotification(t("wallet_cdp_connect_prompt"), "info");
        return;
    }

    try {
        if (showStatus) showNotification(t("wallet_refreshing_balance"));
        const chainId = getChainId(currentSettings);
        const balance = await queryWalletBalance(currentAddress, chainId);

        if (ethSpan) {
            ethSpan.textContent = balance.eth;
        }
        if (usdtSpan) {
            usdtSpan.textContent = balance.usdc;
        }

        if (showStatus) showNotification(t("wallet_refresh_balance_success"));
    } catch (error) {
        if (ethSpan) ethSpan.textContent = "--";
        if (usdtSpan) usdtSpan.textContent = "--";
        if (showStatus) {
            showNotification((error as Error).message ?? t("wallet_refresh_balance_failed"), "error");
        }
    }
}

function getReadableAddress(addr: string): string {
    if (addr.length <= 10) return addr;
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function toggleSettingsPanel(): void {
    const panel = $Id("settings-panel") as HTMLDivElement | null;
    if (!panel) return;

    const willOpen = !panel.classList.contains("open");

    if (willOpen) {
        updateSettingsUI(currentSettings);
    }

    panel.classList.toggle("open", willOpen);
    panel.classList.toggle("hidden", !willOpen);
}

async function handleResetSettings(): Promise<void> {
    currentSettings = {...defaultWalletSettings};
    await saveWalletSettings(currentSettings);
    updateSettingsUI(currentSettings);
    showNotification(t("wallet_node_settings_reset"));
    await refreshBalances();
}

function notifySettingsChanged(): void {
    console.log("------>>> network setting changed.....");
}

function deriveUiNetwork(settings: WalletSettings): UiNetworkOption {
    return settings.network === "base-mainnet" ? "base-mainnet" : "base-sepolia";
}

function applyUiNetworkToForm(uiNetwork: UiNetworkOption): void {
    const networkSelect = $Id("wallet-network-select") as HTMLSelectElement | null;
    const infuraInput = document.querySelector<HTMLInputElement>("#infura-project-id");
    const customRpcInput = document.querySelector<HTMLInputElement>("#custom-rpc-url");
    const saveBtn = $Id("btn-save-settings") as HTMLButtonElement | null;

    if (networkSelect) {
        networkSelect.value = uiNetwork;
    }

    // 自定义 RPC 相关表单全部隐藏
    if (infuraInput) {
        infuraInput.value = "";
        infuraInput.readOnly = true;
        infuraInput.closest(".wallet-setting-row")?.classList.add("hidden");
    }
    if (customRpcInput) {
        customRpcInput.value = "";
        customRpcInput.readOnly = true;
        customRpcInput.closest(".wallet-setting-row")?.classList.add("hidden");
    }
    if (saveBtn) {
        saveBtn.style.display = "none";
    }
}

function updateSettingsUI(settings: WalletSettings): void {
    const networkSelect = $Id("wallet-network-select") as HTMLSelectElement | null;
    if (networkSelect) {
        const uiNetwork = deriveUiNetwork(settings);
        networkSelect.value = uiNetwork;
        applyUiNetworkToForm(uiNetwork);
    }
}

async function handleNetworkSelectChange(select: HTMLSelectElement): Promise<void> {
    const value = select.value as UiNetworkOption;
    currentSettings.network = value;
    await saveWalletSettings(currentSettings);
    showNotification(t("save_success"));
    notifySettingsChanged();
    await refreshBalances();
}

interface TransferEthFormValues {
    to: string;
    amount: string;
    gas?: string;
}

interface TransferTokenFormValues {
    to: string;
    amount: string;
    decimals: number;
    gas?: string;
}

function getReadableNetworkLabel(): string {
    return getReadableNetworkName();
}

function openTransferEthDialog(): Promise<TransferEthFormValues | null> {
    const modal = $Id("transfer-eth-modal") as HTMLDivElement | null;

    if (!modal) {
        return new Promise((resolve) => {
            const to = window.prompt(t("wallet_prompt_transfer_to"), "");
            if (!to) return resolve(null);
            const amount = window.prompt(t("wallet_prompt_transfer_eth_amount"), "");
            if (!amount) return resolve(null);
            const gas = window.prompt(t("wallet_prompt_optional_gas_limit"), "");
            resolve({
                to: to.trim(),
                amount: amount.trim(),
                gas: gas?.trim() || undefined,
            });
        });
    }

    const form = $Id("transfer-eth-form") as HTMLFormElement | null;
    const toInput = $input("#transfer-eth-to");
    const amountInput = $input("#transfer-eth-amount");
    const gasInput = $input("#transfer-eth-gas");
    const errorEl = $Id("transfer-eth-error") as HTMLParagraphElement | null;
    const cancelBtn = $Id("transfer-eth-cancel-btn") as HTMLButtonElement | null;
    const closeBtn = $Id("transfer-eth-close-btn") as HTMLButtonElement | null;
    const maxBtn = $Id("transfer-eth-fill-max") as HTMLButtonElement | null;
    const balanceSpan = $Id("transfer-eth-balance") as HTMLSpanElement | null;
    const networkLabel = $Id("transfer-eth-network-label") as HTMLSpanElement | null;

    if (!form || !toInput || !amountInput || !errorEl) {
        return Promise.resolve(null);
    }

    if (balanceSpan) {
        const bal = getCurrentEthBalanceText();
        balanceSpan.textContent = `${t("wallet_current_balance") || ""}：${bal} ETH`;
    }
    if (networkLabel) {
        networkLabel.textContent = getReadableNetworkLabel();
    }
    if (gasInput) {
        gasInput.value = "";
    }
    toInput.value = "";
    amountInput.value = "";
    errorEl.textContent = "";

    modal.classList.remove("hidden");

    return new Promise<TransferEthFormValues | null>((resolve) => {
        const handleClose = (result: TransferEthFormValues | null) => {
            modal.classList.add("hidden");
            form.removeEventListener("submit", handleSubmit);
            cancelBtn?.removeEventListener("click", handleCancel);
            closeBtn?.removeEventListener("click", handleCancel);
            maxBtn?.removeEventListener("click", handleMax);
            document.removeEventListener("keydown", handleKeydown);
            modal.removeEventListener("click", handleBackdropClick as any);
            resolve(result);
        };

        const handleCancel = () => {
            handleClose(null);
        };

        const handleKeydown = (ev: KeyboardEvent) => {
            if (ev.key === "Escape") {
                ev.preventDefault();
                handleClose(null);
            }
        };

        const handleMax = () => {
            const raw = getCurrentEthBalanceText();
            if (!raw || raw === "--") return;
            amountInput.value = raw.replace(/,/g, "").split(" ")[0];
        };

        const handleSubmit = (ev: Event) => {
            ev.preventDefault();
            errorEl.textContent = "";

            const to = toInput.value.trim();
            const amount = amountInput.value.trim();
            const gas = gasInput?.value.trim() || "";

            if (!to) {
                errorEl.textContent = t("wallet_error_to_required");
                return;
            }
            if (!isAddress(to)) {
                errorEl.textContent = t("wallet_error_invalid_to_address");
                return;
            }
            if (!amount) {
                errorEl.textContent = t("wallet_error_amount_required");
                return;
            }
            const n = Number(amount);
            if (!Number.isFinite(n) || n <= 0) {
                errorEl.textContent =
                    t("wallet_error_amount_invalid") || t("wallet_error_amount_required");
                return;
            }

            if (gas && (!/^\d+$/.test(gas) || Number(gas) < 21000)) {
                errorEl.textContent =
                    t("wallet_error_gas_invalid") || "Gas limit 不合法";
                return;
            }

            handleClose({
                to,
                amount,
                gas: gas || undefined,
            });
        };

        const handleBackdropClick = (ev: MouseEvent) => {
            if (ev.target === modal) {
                handleClose(null);
            }
        };

        form.addEventListener("submit", handleSubmit);
        cancelBtn?.addEventListener("click", handleCancel);
        closeBtn?.addEventListener("click", handleCancel);
        maxBtn?.addEventListener("click", handleMax);
        document.addEventListener("keydown", handleKeydown);
        modal.addEventListener("click", handleBackdropClick);
    });
}

function openTransferTokenDialog(): Promise<TransferTokenFormValues | null> {
    const modal = $Id("transfer-token-modal") as HTMLDivElement | null;
    if (!modal) {
        return Promise.resolve(null);
    }

    const form = $Id("transfer-token-form") as HTMLFormElement | null;
    const toInput = $input("#transfer-token-to");
    const amountInput = $input("#transfer-token-amount");
    const decimalsInput = $input("#transfer-token-decimals");
    const gasInput = $input("#transfer-token-gas");
    const errorEl = $Id("transfer-token-error") as HTMLParagraphElement | null;
    const cancelBtn = $Id("transfer-token-cancel-btn") as HTMLButtonElement | null;
    const closeBtn = $Id("transfer-token-close-btn") as HTMLButtonElement | null;
    const maxBtn = $Id("transfer-token-fill-max") as HTMLButtonElement | null;
    const balanceSpan = $Id("transfer-token-balance") as HTMLSpanElement | null;
    const networkLabel = $Id("transfer-token-network-label") as HTMLSpanElement | null;

    if (!form || !toInput || !amountInput || !errorEl) {
        return Promise.resolve(null);
    }

    toInput.value = "";
    amountInput.value = "";
    if (decimalsInput) {
        decimalsInput.value = "6";
        decimalsInput.readOnly = true;
    }
    if (gasInput) {
        gasInput.value = "";
    }
    errorEl.textContent = "";

    if (balanceSpan) {
        const bal = getCurrentTokenBalanceText();
        balanceSpan.textContent = `${t("wallet_current_balance") || ""}：${bal} USDC`;
    }
    if (networkLabel) {
        networkLabel.textContent = getReadableNetworkLabel();
    }

    modal.classList.remove("hidden");

    return new Promise<TransferTokenFormValues | null>((resolve) => {
        const handleClose = (result: TransferTokenFormValues | null) => {
            modal.classList.add("hidden");
            form.removeEventListener("submit", handleSubmit);
            cancelBtn?.removeEventListener("click", handleCancel);
            closeBtn?.removeEventListener("click", handleCancel);
            maxBtn?.removeEventListener("click", handleMax);
            document.removeEventListener("keydown", handleKeydown);
            modal.removeEventListener("click", handleBackdropClick as any);
            resolve(result);
        };

        const handleCancel = () => {
            handleClose(null);
        };

        const handleKeydown = (ev: KeyboardEvent) => {
            if (ev.key === "Escape") {
                ev.preventDefault();
                handleClose(null);
            }
        };

        const handleMax = () => {
            const raw = getCurrentTokenBalanceText();
            if (!raw || raw === "--") return;
            amountInput.value = raw.replace(/,/g, "").split(" ")[0];
        };

        const handleSubmit = (ev: Event) => {
            ev.preventDefault();
            errorEl.textContent = "";

            const to = toInput.value.trim();
            const amount = amountInput.value.trim();
            const gas = gasInput?.value.trim() || "";
            const decimalsRaw = decimalsInput?.value
                ? Number(decimalsInput.value)
                : 6;

            if (!to) {
                errorEl.textContent = t("wallet_error_to_required");
                return;
            }
            if (!isAddress(to)) {
                errorEl.textContent = t("wallet_error_invalid_to_address");
                return;
            }

            if (!amount) {
                errorEl.textContent = t("wallet_error_amount_required");
                return;
            }
            const n = Number(amount);
            if (!Number.isFinite(n) || n <= 0) {
                errorEl.textContent =
                    t("wallet_error_amount_invalid") || t("wallet_error_amount_required");
                return;
            }

            const decimals =
                Number.isFinite(decimalsRaw) && decimalsRaw > 0
                    ? decimalsRaw
                    : 6;

            if (gas && (!/^\d+$/.test(gas) || Number(gas) < 21000)) {
                errorEl.textContent =
                    t("wallet_error_gas_invalid") || "Gas limit 不合法";
                return;
            }

            handleClose({
                to,
                amount,
                decimals,
                gas: gas || undefined,
            });
        };

        const handleBackdropClick = (ev: MouseEvent) => {
            if (ev.target === modal) {
                handleClose(null);
            }
        };

        form.addEventListener("submit", handleSubmit);
        cancelBtn?.addEventListener("click", handleCancel);
        closeBtn?.addEventListener("click", handleCancel);
        maxBtn?.addEventListener("click", handleMax);
        document.addEventListener("keydown", handleKeydown);
        modal.addEventListener("click", handleBackdropClick);
    });
}

async function handleTransferEth(): Promise<void> {
    if (!currentAddress) {
        showNotification(t("wallet_cdp_connect_prompt"), "info");
        return;
    }

    const formValues = await openTransferEthDialog();
    if (!formValues) {
        return;
    }

    showNotification(t("wallet_cdp_transfer_unavailable"), "info");
}

async function handleTransferToken(): Promise<void> {
    if (!currentAddress) {
        showNotification(t("wallet_cdp_connect_prompt"), "info");
        return;
    }

    const formValues = await openTransferTokenDialog();
    if (!formValues) {
        return;
    }

    showNotification(t("wallet_cdp_transfer_unavailable"), "info");
}

async function handleSignOut(): Promise<void> {
    if (!currentAddress) {
        showNotification(t("wallet_cdp_connect_prompt"), "info");
        return;
    }

    try {
        showLoading(t("wallet_signing_out"));
        await doSignOut();
        currentAddress = null;
        await syncWalletState();
        showNotification(t("wallet_signed_out"));
    } catch (error) {
        showNotification((error as Error).message ?? t("wallet_signout_failed"), "error");
    } finally {
        hideLoading();
    }
}

function setupWalletActionButtons(): void {
    const refreshBtn = $Id("btn-refresh-balance") as HTMLButtonElement | null;
    const exportBtn = $Id("btn-export-private-key") as HTMLButtonElement | null;
    const transferEthBtn = $Id("btn-transfer-eth") as HTMLButtonElement | null;
    const transferTokenBtn = $Id("btn-transfer-token") as HTMLButtonElement | null;
    const openSettingsBtn = document.querySelector<HTMLElement>(
        "#btn-open-settings .wallet-action-inner"
    );
    const resetSettingsBtn = $Id("btn-reset-settings") as HTMLButtonElement | null;
    const backBtn = $Id("wallet-back-btn") as HTMLButtonElement | null;


    const walletMainMenu = $Id("wallet-main-menu") as HTMLDivElement | null;
    const closeMainMenu = () => {
        if (walletMainMenu && !walletMainMenu.classList.contains("hidden")) {
            walletMainMenu.classList.add("hidden");
        }
    };

    refreshBtn?.addEventListener("click", () => {
        closeMainMenu();
        refreshBalances().then();
    });
    exportBtn?.addEventListener("click", () => {
        closeMainMenu();
        handleSignOut().then();
    });
    transferEthBtn?.addEventListener("click", () => {
        closeMainMenu();
        handleTransferEth().then();
    });
    transferTokenBtn?.addEventListener("click", () => {
        closeMainMenu();
        handleTransferToken().then();
    });
    openSettingsBtn?.addEventListener("click", (ev) => {
        ev.stopPropagation();
        closeMainMenu();
        toggleSettingsPanel();
    });

    resetSettingsBtn?.addEventListener("click", () => {
        handleResetSettings().then();
    });
    backBtn?.addEventListener("click", () => {
        showView('#onboarding/main-home', dashRouter);
    });
}

async function syncWalletState(): Promise<void> {
    const walletCreateDiv = $Id("wallet-create-div") as HTMLButtonElement;
    const walletInfoDiv = $Id("wallet-info-area") as HTMLDivElement;

    const walletNewBtn = (walletCreateDiv.querySelector(".btn-create-wallet") as HTMLButtonElement);
    walletNewBtn.textContent = t('cdp_wallet_connect');

    const user = await tryGetSignedInUser();
    currentAddress = user?.evmAccounts?.[0] ?? null;

    if (!currentAddress) {
        walletCreateDiv.style.display = "block";
        walletInfoDiv.style.display = "none";
        walletNewBtn.onclick = async () => {
            await browser.tabs.create({
                url: browser.runtime.getURL("html/cdp_auth.html"),
            });
        };
        const ethSpan = document.querySelector(".wallet-eth-value") as HTMLSpanElement | null;
        const usdtSpan = document.querySelector(".wallet-usdt-value") as HTMLSpanElement | null;
        if (ethSpan) ethSpan.textContent = "--";
        if (usdtSpan) usdtSpan.textContent = "--";
        return;
    }

    walletCreateDiv.style.display = "none";
    walletInfoDiv.style.display = "block";
    populateWalletInfo(walletInfoDiv, currentAddress).then();
}

async function populateWalletInfo(container: HTMLDivElement, address: string): Promise<void> {
    const addressSpan = container.querySelector(".wallet-address-value") as HTMLSpanElement;
    const ethSpan = container.querySelector(".wallet-eth-value") as HTMLSpanElement;
    const usdtSpan = container.querySelector(".wallet-usdt-value") as HTMLSpanElement;

    if (addressSpan) {
        addressSpan.textContent = `${address} (${getReadableAddress(address)})`;
    }
    if (ethSpan) {
        ethSpan.textContent = "--";
    }
    if (usdtSpan) {
        usdtSpan.textContent = "--";
    }

    await refreshBalances(false);
}

export async function initWalletOrCreate(): Promise<void> {
    const walletCreateDiv = $Id("wallet-create-div") as HTMLButtonElement;
    const walletInfoDiv = $Id("wallet-info-area") as HTMLDivElement;
    const walletSettingBtn = $Id("wallet-settings-btn") as HTMLButtonElement;
    const walletMainBtn = $Id("btn-main-menu") as HTMLButtonElement;
    const walletMainMenu = $Id("wallet-main-menu") as HTMLDivElement;

    currentSettings = await loadWalletSettings();
    updateSettingsUI(currentSettings);

    await syncWalletState();

    walletSettingBtn.onclick = () => {
        showView('#onboarding/wallet-setting', dashRouter);
    };

    walletMainBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        walletMainMenu.classList.toggle("hidden");
    });

    walletMainMenu.addEventListener("click", (ev) => {
        ev.stopPropagation();
    });

    document.addEventListener("click", (ev) => {
        const target = ev.target as Node | null;
        if (!target) return;

        if (walletMainMenu && !walletMainMenu.classList.contains("hidden")) {
            const clickedInsideMenu = walletMainMenu.contains(target as Node);
            const clickedOnTrigger = walletMainBtn.contains(target as Node);
            if (!clickedInsideMenu && !clickedOnTrigger) {
                walletMainMenu.classList.add("hidden");
            }
        }

        const settingsPanel = $Id("settings-panel");
        if (settingsPanel && settingsPanel.classList.contains("open")) {
            const insidePanel = settingsPanel.contains(target as Node);
            const isSettingsBtn = (ev.target as HTMLElement).closest("#btn-open-settings");
            if (!insidePanel && !isSettingsBtn) {
                settingsPanel.classList.remove("open");
                settingsPanel.classList.add("hidden");
            }
        }
    });

    setupWalletActionButtons();
}

export function initDashboardTexts(): void {
    const mainMenuBtn = $Id('btn-main-menu') as HTMLButtonElement | null;
    if (mainMenuBtn) {
        mainMenuBtn.title = t('main_menu_title');
    }

    const walletSettingsBtn = $Id('wallet-settings-btn') as HTMLButtonElement | null;
    if (walletSettingsBtn) {
        const label = t('wallet_settings_title');
        walletSettingsBtn.title = label;
        walletSettingsBtn.setAttribute('aria-label', label);
    }

    const walletSettingsTitle = $Id('wallet-settings-title');
    if (walletSettingsTitle) {
        walletSettingsTitle.textContent = t('wallet_settings_title');
    }

    const signMsgLabel = $Id('wallet-action-sign-message-label');
    if (signMsgLabel) signMsgLabel.style.display = 'none';

    const signTypedLabel = $Id('wallet-action-sign-typed-data-label');
    if (signTypedLabel) signTypedLabel.style.display = 'none';

    const verifySigLabel = $Id('wallet-action-verify-signature-label');
    if (verifySigLabel) verifySigLabel.style.display = 'none';

    const nodeSettingsLabel = $Id('wallet-action-open-settings-label');
    if (nodeSettingsLabel) nodeSettingsLabel.textContent = t('wallet_action_network_settings');

    const btnRefresh = $Id('btn-refresh-balance');
    if (btnRefresh) btnRefresh.textContent = t('wallet_action_refresh_balance');

    const btnExportPk = $Id('btn-export-private-key');
    if (btnExportPk) btnExportPk.textContent = t('wallet_action_sign_out');

    const btnTransferEth = $Id('btn-transfer-eth');
    if (btnTransferEth) btnTransferEth.textContent = t('wallet_action_transfer_eth');

    const btnTransferToken = $Id('btn-transfer-token');
    if (btnTransferToken) btnTransferToken.textContent = t('wallet_action_transfer_token');

    const networkTitle = $Id('wallet-network-title');
    if (networkTitle) networkTitle.textContent = t('wallet_network_title');

    const networkSelectLabel = $Id('wallet-network-select-label');
    if (networkSelectLabel) networkSelectLabel.textContent = t('wallet_network_select_label');

    const networkOptionMain = $Id('wallet-network-option-base-mainnet');
    if (networkOptionMain) networkOptionMain.textContent = t('wallet_network_option_base_mainnet');

    const networkOptionSepolia = $Id('wallet-network-option-base-sepolia');
    if (networkOptionSepolia) networkOptionSepolia.textContent = t('wallet_network_option_base_sepolia');

    const nodeRpcTitle = $Id('wallet-node-rpc-title');
    if (nodeRpcTitle) nodeRpcTitle.textContent = t('wallet_network_title');

    const networkSelect = $Id("wallet-network-select") as HTMLSelectElement | null;
    const saveBtn = $Id('btn-save-settings') as HTMLButtonElement | null;

    if (networkSelect) {
        const uiNetwork = deriveUiNetwork(currentSettings);
        networkSelect.value = uiNetwork;
        applyUiNetworkToForm(uiNetwork);

        networkSelect.addEventListener("change", () => {
            handleNetworkSelectChange(networkSelect).then();
        });
    }

    if (saveBtn) {
        saveBtn.style.display = "none";
    }

    const resetBtn = $Id('btn-reset-settings');
    if (resetBtn) resetBtn.textContent = t('wallet_reset_settings');

    const transferTitle = $Id('transfer-eth-title');
    if (transferTitle) {
        transferTitle.textContent = t('wallet_transfer_eth_title');
    }

    const transferSubtitle = $Id('transfer-eth-subtitle');
    if (transferSubtitle) {
        transferSubtitle.textContent = t('wallet_transfer_eth_subtitle');
    }

    const toLabel = $Id('transfer-eth-to-label');
    if (toLabel) {
        toLabel.textContent = t('wallet_transfer_to_label');
    }
    const toInput = $input('#transfer-eth-to');
    if (toInput) {
        toInput.placeholder = t('wallet_transfer_to_hint');
    }
    const toHint = $Id('transfer-eth-to-hint');
    if (toHint) {
        toHint.textContent = t('wallet_transfer_to_hint');
    }

    const amountLabel = $Id('transfer-eth-amount-label');
    if (amountLabel) {
        amountLabel.textContent = t('wallet_transfer_amount_label');
    }
    const amountInput = $input('#transfer-eth-amount');
    if (amountInput) {
        amountInput.placeholder = t('wallet_transfer_amount_label');
    }

    const feeHint = $Id('transfer-eth-fee-hint');
    if (feeHint) {
        feeHint.textContent = t('wallet_transfer_fee_hint');
    }

    const gasLabel = $Id('transfer-eth-gas-label');
    if (gasLabel) {
        gasLabel.textContent = t('wallet_transfer_gas_label');
    }
    const gasInput = $input('#transfer-eth-gas');
    if (gasInput) {
        gasInput.placeholder = t('wallet_transfer_gas_label');
    }

    const gasHint = $Id('transfer-eth-gas-hint');
    if (gasHint) {
        gasHint.textContent = t('wallet_transfer_gas_hint');
    }

    const submitBtn = $Id('transfer-eth-submit-btn') as HTMLButtonElement | null;
    if (submitBtn) {
        submitBtn.textContent = t('wallet_transfer_confirm_btn');
    }

    const cancelBtn = $Id('transfer-eth-cancel-btn') as HTMLButtonElement | null;
    if (cancelBtn) {
        cancelBtn.textContent = t('cancel');
    }

    const fillMaxBtn = $Id('transfer-eth-fill-max') as HTMLButtonElement | null;
    if (fillMaxBtn) {
        fillMaxBtn.textContent = t('wallet_transfer_fill_max_btn');
    }

    const tokenTitle = $Id('transfer-token-title');
    if (tokenTitle) {
        tokenTitle.textContent = t('wallet_transfer_token_title');
    }

    const tokenSubtitle = $Id('transfer-token-subtitle');
    if (tokenSubtitle) {
        tokenSubtitle.textContent = t('wallet_transfer_token_subtitle');
    }

    const tokenToLabel = $Id('transfer-token-to-label');
    if (tokenToLabel) {
        tokenToLabel.textContent = t('wallet_transfer_to_label');
    }
    const tokenToInput = $input('#transfer-token-to');
    if (tokenToInput) {
        tokenToInput.placeholder = t('wallet_transfer_to_hint');
    }
    const tokenToHint = $Id('transfer-token-to-hint');
    if (tokenToHint) {
        tokenToHint.textContent = t('wallet_transfer_to_hint');
    }

    const tokenAmountLabel = $Id('transfer-token-amount-label');
    if (tokenAmountLabel) {
        tokenAmountLabel.textContent = t('wallet_transfer_token_amount_label');
    }
    const tokenAmountInput = $input('#transfer-token-amount');
    if (tokenAmountInput) {
        tokenAmountInput.placeholder = t('wallet_transfer_token_amount_label');
    }

    const tokenFeeHint = $Id('transfer-token-fee-hint');
    if (tokenFeeHint) {
        tokenFeeHint.textContent = t('wallet_transfer_token_fee_hint');
    }

    const tokenDecimalsLabel = $Id('transfer-token-decimals-label');
    if (tokenDecimalsLabel) {
        tokenDecimalsLabel.textContent = t('wallet_token_decimals_label');
    }

    const tokenGasLabel = $Id('transfer-token-gas-label');
    if (tokenGasLabel) {
        tokenGasLabel.textContent = t('wallet_transfer_gas_label');
    }
    const tokenGasInput = $input('#transfer-token-gas');
    if (tokenGasInput) {
        tokenGasInput.placeholder = t('wallet_transfer_gas_label');
    }

    const tokenGasHint = $Id('transfer-token-gas-hint');
    if (tokenGasHint) {
        tokenGasHint.textContent = t('wallet_transfer_gas_hint');
    }

    const tokenSubmitBtn = $Id('transfer-token-submit-btn') as HTMLButtonElement | null;
    if (tokenSubmitBtn) {
        tokenSubmitBtn.textContent = t('wallet_transfer_token_confirm_btn');
    }

    const tokenCancelBtn = $Id('transfer-token-cancel-btn') as HTMLButtonElement | null;
    if (tokenCancelBtn) {
        tokenCancelBtn.textContent = t('cancel');
    }
}
