import {$Id, $input, hideLoading, showAlert, showLoading, showNotification} from "./common";
import {t} from "../common/i18n";
import {requestPassword} from "./password_modal";
import {ethers} from "ethers";
import {
    defaultWalletSettings,
    loadWallet,
    loadWalletSettings,
    saveWalletSettings, signTypedData,
    TCWallet, verifySignature,
    WalletSettings
} from "../wallet/wallet_api";
import {
    BASE_MAINNET_CHAIN_ID,
    BASE_MAINNET_DEFAULT_RPC,
    BASE_MAINNET_USDC,
    BASE_SEPOLIA_CHAIN_ID, BASE_SEPOLIA_DEFAULT_RPC,
    BASE_SEPOLIA_USDC, ERC20_ABI, MsgType
} from "../common/consts";
import {sendMsgToService, showView} from "../common/utils";
import {dashRouter} from "./dashboard";
import browser from "webextension-polyfill";

type UiNetworkOption = 'base-mainnet' | 'base-sepolia' | 'custom';
type PasswordPrompt = () => Promise<string>;
let currentWallet: TCWallet | null = null;
let currentSettings: WalletSettings = {...defaultWalletSettings};

function openTransferEthDialog(): Promise<TransferEthFormValues | null> {
    const modal = $Id("transfer-eth-modal") as HTMLDivElement | null;

    // 如果还没加 HTML，兜底用旧的 prompt 流程
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
        // 结构不完整就直接退出
        return Promise.resolve(null);
    }

    // 初始化展示文案（余额/网络）
    if (balanceSpan) {
        const bal = getCurrentEthBalanceText();
        balanceSpan.textContent = `${t("wallet_current_balance") || ""}：${bal} ETH`;
    }
    if (networkLabel) {
        networkLabel.textContent = getReadableNetworkName();
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
            const numeric = raw.replace(/,/g, "").split(" ")[0];
            amountInput.value = numeric;
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
            if (!ethers.utils.isAddress(to)) {
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

async function handleTransferEth(): Promise<void> {
    if (!currentWallet) {
        showNotification(t("wallet_error_no_wallet"), "info");
        return;
    }

    const formValues = await openTransferEthDialog();
    if (!formValues) {
        return;
    }

    const {to, amount, gas} = formValues;

    try {
        const password = await requestPassword(t("wallet_prompt_password_send_eth"))
        showLoading(t("wallet_sending_transaction"));

        const resp = await sendMsgToService({to, amountEther: amount, gas, password}, MsgType.WalletTransferEth)

        if (!resp?.success) {
            showNotification(resp?.error || "TRANSFER_FAILED");
            return
        }
        showNotification(t("wallet_transfer_tx_sent") + resp.txHash);
        await refreshBalances();
    } catch (error) {
        showNotification(
            (error as Error).message ?? t("wallet_transfer_eth_failed"),
            "error",
        );
    } finally {
        hideLoading()
    }
}

async function refreshBalances(showStatus = true): Promise<void> {
    const ethSpan = document.querySelector(".wallet-eth-value") as HTMLSpanElement | null;
    const usdtSpan = document.querySelector(".wallet-usdt-value") as HTMLSpanElement | null;

    if (!currentWallet) {
        if (ethSpan) ethSpan.textContent = "--";
        if (usdtSpan) usdtSpan.textContent = "--";
        if (showStatus) showNotification(t('wallet_error_no_wallet'), "error");
        return;
    }

    try {
        if (showStatus) showNotification(t('wallet_refreshing_balance'));
        const provider = createProvider(currentSettings);
        const usdtContract = new ethers.Contract(getDefaultUsdcAddress(currentSettings), ERC20_ABI, provider);

        const [ethBalance, usdtBalance] = await Promise.all([
            provider.getBalance(currentWallet.address),
            usdtContract.balanceOf(currentWallet.address)
        ]);

        if (ethSpan) {
            ethSpan.textContent = formatTokenAmount(ethBalance, 18);
        }
        if (usdtSpan) {
            usdtSpan.textContent = formatTokenAmount(usdtBalance, 6);
        }

        if (showStatus) showNotification(t('wallet_refresh_balance_success'));
    } catch (error) {
        if (showStatus) {
            showNotification((error as Error).message ?? t('wallet_refresh_balance_failed'), "error");
        }
    }
}


function getChainId(settings: WalletSettings): number {
    return settings.network === 'base-mainnet'
        ? BASE_MAINNET_CHAIN_ID
        : BASE_SEPOLIA_CHAIN_ID;
}

function getDefaultUsdcAddress(settings: WalletSettings): string {
    return settings.network === 'base-mainnet'
        ? BASE_MAINNET_USDC
        : BASE_SEPOLIA_USDC;
}


async function handleResetSettings(): Promise<void> {
    currentSettings = {...defaultWalletSettings};
    updateSettingsUI(currentSettings);
    await saveWalletSettings(currentSettings);
    showNotification(t('wallet_node_settings_reset'));
    notifySettingsChanged();
    await refreshBalances();
}

function notifySettingsChanged(): void {
    console.log("------>>> infura setting changed.....")
}


function getRpcEndpoint(settings: WalletSettings): string {
    const net = settings.network; // 只返回 base-mainnet / base-sepolia
    const infuraId = settings.infuraProjectId?.trim();
    const custom = settings.customRpcUrl?.trim();

    // 1) 若 useDefaultRpc === false 且配置了 customRpcUrl，则优先使用自定义 RPC
    if (!settings.useDefaultRpc && custom) {
        return custom;
    }

    // 2) 否则如果配置了 Infura，则用 Infura 节点
    if (infuraId) {
        if (net === 'base-mainnet') {
            return `https://base-mainnet.infura.io/v3/${infuraId}`;
        }
        return `https://base-sepolia.infura.io/v3/${infuraId}`;
    }

    // 3) 最后使用官方公共 RPC
    if (net === 'base-mainnet') {
        return BASE_MAINNET_DEFAULT_RPC;
    }
    return BASE_SEPOLIA_DEFAULT_RPC;
}

function createProvider(settings: WalletSettings): ethers.providers.JsonRpcProvider {
    const rpcUrl = getRpcEndpoint(settings);
    const chainId = getChainId(settings);
    return new ethers.providers.JsonRpcProvider(rpcUrl, chainId);
}

function formatTokenAmount(value: ethers.BigNumber, decimals: number): string {
    const formatted = ethers.utils.formatUnits(value, decimals);
    const numeric = Number(formatted);
    if (!Number.isFinite(numeric)) {
        return formatted;
    }
    return numeric.toLocaleString(undefined, {maximumFractionDigits: Math.min(decimals, 6)});
}

async function handleExportPrivateKey(): Promise<void> {
    if (!currentWallet) {
        showNotification(t("wallet_error_no_wallet"), "info");
        return;
    }

    try {
        const password = await requestPassword(
            t("wallet_prompt_password_export_pk")
        );
        showLoading(t("wallet_decrypting"));

        const resp = await sendMsgToService(password, MsgType.WalletExportPrivateKey)
        if (!resp?.success) {
            showNotification(t("wallet_export_pk_failed"));
            return;
        }

        showAlert(t("wallet_export_pk_alert_prefix") + t("wallet_export_pk_warning"), resp.privateKey)
    } catch (error) {
        showNotification((error as Error).message ?? t("wallet_export_pk_failed"), "error");
    }finally {
        hideLoading()
    }
}

async function handleTransferToken(): Promise<void> {
    if (!currentWallet) {
        showNotification(t("wallet_error_no_wallet"), "info");
        return;
    }

    const formValues = await openTransferTokenDialog();
    if (!formValues) {
        return;
    }

    const {to, amount, decimals, gas} = formValues;
    const tokenAddress = getDefaultUsdcAddress(currentSettings); // 固定用当前网络 USDC

    try {
        const password = await requestPassword(
            t("wallet_prompt_password_send_token")
        );

        showLoading(t("wallet_sending_transaction"));

        const resp = await sendMsgToService({
            tokenAddress,
            to,
            amount,
            decimals,
            gas,
            password
        }, MsgType.WalletTransferUSDC)
        if (!resp?.success) {
            showNotification(resp?.error || "TRANSFER_FAILED");
            return
        }

        showNotification(t("wallet_transfer_token_tx_sent") + resp.txHash);
        await refreshBalances();
    } catch (error) {
        showNotification(
            (error as Error).message ?? t("wallet_transfer_token_failed"),
            "error",
        );
    } finally {
        hideLoading()
    }
}

export async function handleSignMessage(): Promise<void> {
    if (!currentWallet) {
        showNotification(t("wallet_error_no_wallet"), "info");
        return;
    }

    const message = window.prompt(t("wallet_prompt_sign_message"), "");
    if (message === null) return;

    try {
        const password = await requestPassword(
            t("wallet_prompt_password_sign_message")
        );
        showLoading(t("wallet_signing"));

        const resp = await sendMsgToService({message, password}, MsgType.WalletSignMessage)
        if (!resp?.success) {
            showNotification(resp?.error || "SIGN_FAILED");
            return;
        }
        showAlert(t("wallet_sign_message_success"), t("wallet_sign_message_alert_prefix") + resp.signature)
    } catch (error) {
        showNotification((error as Error).message ?? t("wallet_sign_message_failed"), "error");
    } finally {
        hideLoading()
    }
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

async function populateWalletInfo(container: HTMLDivElement, wallet: TCWallet): Promise<void> {
    const addressSpan = container.querySelector(".wallet-address-value") as HTMLSpanElement;
    const ethSpan = container.querySelector(".wallet-eth-value") as HTMLSpanElement;
    const usdtSpan = container.querySelector(".wallet-usdt-value") as HTMLSpanElement;

    if (addressSpan) {
        addressSpan.textContent = wallet.address;
    }
    if (ethSpan) {
        ethSpan.textContent = "--";
    }
    if (usdtSpan) {
        usdtSpan.textContent = "--";
    }

    await refreshBalances(false);
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
        handleExportPrivateKey().then();
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
        closeMainMenu();               // 虽然这个按钮不在下拉菜单里，但多关一次没坏处
        toggleSettingsPanel();
    });

    resetSettingsBtn?.addEventListener("click", () => {
        handleResetSettings().then();
    });
    backBtn?.addEventListener("click", () => {
        showView('#onboarding/main-home', dashRouter);
    });
}

export async function initWalletOrCreate(): Promise<void> {
    const walletCreateDiv = $Id("wallet-create-div") as HTMLButtonElement;//btn-create-wallet
    const walletInfoDiv = $Id("wallet-info-area") as HTMLDivElement;
    const walletSettingBtn = $Id("wallet-settings-btn") as HTMLButtonElement;
    const walletMainBtn = $Id("btn-main-menu") as HTMLButtonElement;
    const walletMainMenu = $Id("wallet-main-menu") as HTMLDivElement;

    currentWallet = await loadWallet();
    currentSettings = await loadWalletSettings();

    const walletNewBtn = (walletCreateDiv.querySelector(".btn-create-wallet") as HTMLButtonElement);
    walletNewBtn.textContent = t('new_web3_id');
    if (!currentWallet) {
        walletCreateDiv.style.display = "block";
        walletInfoDiv.style.display = "none";
        walletNewBtn.onclick = async () => {
            await browser.tabs.create({
                url: browser.runtime.getURL("html/wallet_new.html"),
            });
        };
        return;
    }

    walletCreateDiv.style.display = "none";
    walletInfoDiv.style.display = "block";
    // (document.querySelector(".logo-container") as HTMLDivElement).style.display = 'none';
    populateWalletInfo(walletInfoDiv, currentWallet).then();

    walletSettingBtn.onclick = () => {
        showView('#onboarding/wallet-setting', dashRouter);
    }

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

        // 已经是隐藏的，就不用处理了
        if (walletMainMenu.classList.contains("hidden")) {
            return;
        }

        // 点在菜单内部：不关闭
        if (walletMainMenu.contains(target)) {
            return;
        }

        // 点在按钮本身（或按钮里的 svg）：不关闭
        if (walletMainBtn === target || walletMainBtn.contains(target)) {
            return;
        }

        // 其它情况：关闭菜单
        walletMainMenu.classList.add("hidden");
    });

    setupWalletActionButtons();
    updateSettingsUI(currentSettings);
}


async function handleNetworkSelectChange(select: HTMLSelectElement): Promise<void> {
    const value = select.value as UiNetworkOption;

    if (value === "base-mainnet" || value === "base-sepolia") {
        // === 1) 修改内存中的 WalletSettings ===
        if (value === "base-mainnet") {
            currentSettings.network = "base-mainnet";
        } else {
            currentSettings.network = "base-sepolia";
        }
        currentSettings.infuraProjectId = undefined;
        currentSettings.customRpcUrl = undefined;
        currentSettings.useDefaultRpc = true;

        // === 2) 更新表单显示（只读字段 & 默认 RPC）===
        applyUiNetworkToForm(value, currentSettings);

        // === 3) 持久化设置 & 同步兼容字段 ===
        await saveWalletSettings(currentSettings);
        showNotification(t("save_success"));
        await refreshBalances();
    } else {
        // custom：只更新 UI，不立即保存，等待用户点「保存」按钮
        applyUiNetworkToForm("custom", currentSettings);
    }
}

async function handleSaveSettingsClick(select: HTMLSelectElement): Promise<void> {
    const uiNetwork = select.value as UiNetworkOption;

    // 保险：只有 custom 模式才需要「保存」按钮
    if (uiNetwork !== "custom") {
        return;
    }

    const infuraInput = document.querySelector<HTMLInputElement>("#infura-project-id");
    const customRpcInput = document.querySelector<HTMLInputElement>("#custom-rpc-url");
    if (!infuraInput || !customRpcInput) return;

    const infura = infuraInput.value.trim();
    const customRpc = customRpcInput.value.trim();

    // custom：Base Sepolia + 自定义 RPC
    currentSettings.network = "base-sepolia";
    currentSettings.infuraProjectId = infura || undefined;
    currentSettings.customRpcUrl = customRpc || undefined;
    currentSettings.useDefaultRpc = false;

    await saveWalletSettings(currentSettings);
    showNotification(t("save_success"));
    await refreshBalances();
}

interface TransferEthFormValues {
    to: string;
    amount: string;
    gas?: string;
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

/**
 * 打开 ETH 转账表单弹窗，返回用户输入的参数；取消则返回 null。
 */

function openTransferTokenDialog(): Promise<TransferTokenFormValues | null> {
    const modal = $Id("transfer-token-modal") as HTMLDivElement | null;
    if (!modal) {
        // 没有 DOM，直接视为取消
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

    // 初始化默认值
    toInput.value = "";
    amountInput.value = "";
    if (decimalsInput) {
        decimalsInput.value = "6";
        // USDC 精度固定 6，可以视情况设为只读
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
        networkLabel.textContent = getReadableNetworkName();
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
            const numeric = raw.replace(/,/g, "").split(" ")[0];
            amountInput.value = numeric;
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
            if (!ethers.utils.isAddress(to)) {
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

interface TransferTokenFormValues {
    to: string;
    amount: string;
    decimals: number;
    gas?: string;
}


function getCurrentTokenBalanceText(): string {
    const span = document.querySelector<HTMLSpanElement>(".wallet-usdt-value");
    return span?.textContent?.trim() || "--";
}


export function initDashboardTexts(): void {
    // 顶部菜单按钮
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

    // 钱包设置子页标题
    const walletSettingsTitle = $Id('wallet-settings-title');
    if (walletSettingsTitle) {
        walletSettingsTitle.textContent = t('wallet_settings_title');
    }

    // 钱包动作列表
    const signMsgLabel = $Id('wallet-action-sign-message-label');
    if (signMsgLabel) signMsgLabel.textContent = t('wallet_action_sign_message');

    const signTypedLabel = $Id('wallet-action-sign-typed-data-label');
    if (signTypedLabel) signTypedLabel.textContent = t('wallet_action_sign_typed_data');

    const verifySigLabel = $Id('wallet-action-verify-signature-label');
    if (verifySigLabel) verifySigLabel.textContent = t('wallet_action_verify_signature');

    const nodeSettingsLabel = $Id('wallet-action-open-settings-label');
    if (nodeSettingsLabel) nodeSettingsLabel.textContent = t('wallet_action_node_settings');

    // 顶部钱包主菜单四个按钮
    const btnRefresh = $Id('btn-refresh-balance');
    if (btnRefresh) btnRefresh.textContent = t('wallet_action_refresh_balance');

    const btnExportPk = $Id('btn-export-private-key');
    if (btnExportPk) btnExportPk.textContent = t('wallet_action_export_private_key');

    const btnTransferEth = $Id('btn-transfer-eth');
    if (btnTransferEth) btnTransferEth.textContent = t('wallet_action_transfer_eth');

    const btnTransferToken = $Id('btn-transfer-token');
    if (btnTransferToken) btnTransferToken.textContent = t('wallet_action_transfer_token');

    // 网络选择
    const networkTitle = $Id('wallet-network-title');
    if (networkTitle) networkTitle.textContent = t('wallet_network_title');

    const networkSelectLabel = $Id('wallet-network-select-label');
    if (networkSelectLabel) networkSelectLabel.textContent = t('wallet_network_select_label');

    const networkOptionMain = $Id('wallet-network-option-base-mainnet');
    if (networkOptionMain) networkOptionMain.textContent = t('wallet_network_option_base_mainnet');

    const networkOptionSepolia = $Id('wallet-network-option-base-sepolia');
    if (networkOptionSepolia) networkOptionSepolia.textContent = t('wallet_network_option_base_sepolia');

    // 节点与 RPC 设置区
    const nodeRpcTitle = $Id('wallet-node-rpc-title');
    if (nodeRpcTitle) nodeRpcTitle.textContent = t('wallet_node_rpc_title');

    const infuraLabel = $Id('wallet-infura-label');
    if (infuraLabel) infuraLabel.textContent = t('wallet_infura_project_id_label');
    const infuraInput = $input('#infura-project-id');
    if (infuraInput) infuraInput.placeholder = t('wallet_infura_project_id_placeholder');

    const customRpcLabel = $Id('wallet-custom-rpc-label');
    if (customRpcLabel) customRpcLabel.textContent = t('wallet_custom_rpc_url_label');
    const customRpcInput = $input('#custom-rpc-url');
    if (customRpcInput) customRpcInput.placeholder = t('wallet_custom_rpc_url_placeholder');

    const networkSelect = $Id("wallet-network-select") as HTMLSelectElement | null;
    const saveBtn = $Id('btn-save-settings') as HTMLButtonElement | null;

    if (networkSelect) {
        const uiNetwork = deriveUiNetwork(currentSettings);
        networkSelect.value = uiNetwork;
        applyUiNetworkToForm(uiNetwork, currentSettings);

        networkSelect.addEventListener("change", () => {
            handleNetworkSelectChange(networkSelect).then();
        });
    }

    if (saveBtn && networkSelect) {
        saveBtn.textContent = t('wallet_save_settings');
        saveBtn.addEventListener("click", () => {
            handleSaveSettingsClick(networkSelect).then();
        });
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

    // === Token / USDC 转账弹窗文案 ===
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
        tokenCancelBtn.textContent = t('cancel'); // 或 common_cancel
    }

}


/**
 * 从 WalletSettings 推导出 UI 下拉应该选哪个：
 * - mainnet → base-mainnet
 * - sepolia 且没有自定义 RPC → base-sepolia
 * - sepolia 且有自定义 RPC（useDefaultRpc === false 且 customRpcUrl 有值）→ custom
 */
function deriveUiNetwork(settings: WalletSettings): UiNetworkOption {
    if (settings.network === 'base-mainnet') {
        return 'base-mainnet';
    }

    // 其它情况一律视为 base-sepolia 环境
    const hasCustomRpc = !!settings.customRpcUrl && settings.customRpcUrl.trim().length > 0;
    if (!settings.useDefaultRpc && hasCustomRpc) {
        return 'custom';
    }
    return 'base-sepolia';
}

/**
 * 根据 UI 下拉的选项，把「输入框的值/只读状态/保存按钮」同步到 DOM。
 * 注意这里不会改 currentSettings，只是更新表单。
 */
function applyUiNetworkToForm(uiNetwork: UiNetworkOption, settings: WalletSettings): void {
    const infuraInput = document.querySelector<HTMLInputElement>("#infura-project-id");
    const customRpcInput = document.querySelector<HTMLInputElement>("#custom-rpc-url");
    const saveBtn = $Id('btn-save-settings') as HTMLButtonElement | null;

    if (!infuraInput || !customRpcInput) return;

    if (uiNetwork === "base-mainnet") {
        // 主网：使用固定公共 RPC，字段只读、隐藏保存按钮
        infuraInput.value = "";
        customRpcInput.value = BASE_MAINNET_DEFAULT_RPC;
        infuraInput.readOnly = true;
        customRpcInput.readOnly = true;
        if (saveBtn) saveBtn.style.display = "none";
    } else if (uiNetwork === "base-sepolia") {
        // Sepolia：使用固定公共 RPC，字段只读、隐藏保存按钮
        infuraInput.value = "";
        customRpcInput.value = BASE_SEPOLIA_DEFAULT_RPC;
        infuraInput.readOnly = true;
        customRpcInput.readOnly = true;
        if (saveBtn) saveBtn.style.display = "none";
    } else {
        // custom：Base Sepolia + 自定义 RPC，可编辑
        infuraInput.readOnly = false;
        customRpcInput.readOnly = false;
        infuraInput.value = settings.infuraProjectId ?? "";
        customRpcInput.value = settings.customRpcUrl ?? "";
        if (saveBtn) saveBtn.style.display = "";
    }
}

function updateSettingsUI(settings: WalletSettings): void {
    const infuraInput = $Id("infura-project-id") as HTMLInputElement | null;
    const customInput = $Id("custom-rpc-url") as HTMLInputElement | null;

    if (infuraInput) {
        infuraInput.value = settings.infuraProjectId ?? "";
    }
    if (customInput) {
        customInput.value = settings.customRpcUrl ?? "";
    }

    // 现在不再使用 rpc-mode 单选按钮，直接通过下拉 + useDefaultRpc 推导
    const networkSelect = $Id("wallet-network-select") as HTMLSelectElement | null;
    if (networkSelect) {
        const uiNetwork = deriveUiNetwork(settings);
        networkSelect.value = uiNetwork;
        applyUiNetworkToForm(uiNetwork, settings);
    }
}
