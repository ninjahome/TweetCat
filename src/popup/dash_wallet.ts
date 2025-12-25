import {$Id, $input, hideLoading, showLoading, showNotification, showPopupWindow} from "./common";
import {t} from "../common/i18n";
import {ethers} from "ethers";
import {showView} from "../common/utils";
import {dashRouter} from "./dashboard";
import browser from "webextension-polyfill";
import {getReadableNetworkName, initSettingsPanel,} from "./dash_setting";
import {doSignOut, X402_FACILITATORS} from "../common/x402_obj";
import {
    getWalletAddress,
    queryCdpWalletInfo,
    transferETHEoa, transferUSDCEoa
} from "../wallet/cdp_wallet";
import {getChainId} from "../wallet/wallet_setting";

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
    const formValues = await openTransferEthDialog();
    if (!formValues) {
        return;
    }

    const {to, amount} = formValues;
    try {
        showLoading(t("wallet_sending_transaction") || "");
        const chainID = await getChainId()
        const hash = await transferETHEoa(chainID, to, amount)
        browser.tabs.create({url: X402_FACILITATORS[chainID].browser + "/tx/" + hash}).then()
        refreshBalances().then();
    } catch (error) {
        console.log(error)
        showNotification(
            (error as Error).message ?? t("wallet_transfer_eth_failed"),
            "error",
        );
    } finally {
        hideLoading()
    }
}

export async function refreshBalances(showStatus = true): Promise<void> {
    const ethSpan = document.querySelector(".wallet-eth-value") as HTMLSpanElement | null;
    const usdcSpan = document.querySelector(".wallet-usdt-value") as HTMLSpanElement | null;

    try {
        if (showStatus) showNotification(t('wallet_refreshing_balance'));
        const walletInfo = await queryCdpWalletInfo()
        if (!walletInfo.hasCreated) {
            if (ethSpan) ethSpan.textContent = "--";
            if (usdcSpan) usdcSpan.textContent = "--";
            if (showStatus) showNotification(t('wallet_error_no_wallet'), "error");
            return;
        }

        if (ethSpan) {
            ethSpan.textContent = walletInfo.ethVal
        }
        if (usdcSpan) {
            usdcSpan.textContent = walletInfo.usdcVal
        }
        if (showStatus) showNotification(t('wallet_refresh_balance_success'));
    } catch (error) {
        if (showStatus) {
            showNotification((error as Error).message ?? t('wallet_refresh_balance_failed'), "error");
        }
    }
}

async function showBalanceOnBrowser(): Promise<void> {
    const addr = await getWalletAddress()
    if (!addr) {
        return
    }
    const chainID = await getChainId()
    const url = X402_FACILITATORS[chainID].browser + "/address/" + addr
    await browser.tabs.create({url})
}


async function handleTransferToken(): Promise<void> {

    const formValues = await openTransferTokenDialog();
    if (!formValues) {
        return;
    }
    const {to, amount} = formValues;
    try {
        showLoading(t("wallet_sending_transaction"));
        const chainID = await getChainId()
        const hash = await transferUSDCEoa(chainID, to, amount)
        browser.tabs.create({url: X402_FACILITATORS[chainID].browser + "/tx/" + hash}).then()
        refreshBalances().then();
    } catch (error) {
        showNotification(
            (error as Error).message ?? t("wallet_transfer_token_failed"),
            "error",
        );
    } finally {
        hideLoading()
    }
}

function setupWalletActionButtons(): void {
    const refreshBtn = $Id("btn-refresh-balance") as HTMLButtonElement;
    refreshBtn.textContent = t('wallet_action_refresh_balance');
    refreshBtn.onclick = async () => refreshBalances(true)


    const showBtn = $Id("btn-show-on-browser") as HTMLButtonElement;
    showBtn.textContent = t('wallet_action_show_on_browser');
    showBtn.onclick = async () => showBalanceOnBrowser()

    const transferEthBtn = $Id("btn-transfer-eth") as HTMLButtonElement;
    transferEthBtn.textContent = t('wallet_action_transfer_eth');
    transferEthBtn.onclick = async () => handleTransferEth()

    const transferTokenBtn = $Id("btn-transfer-token") as HTMLButtonElement;
    transferTokenBtn.onclick = async () => handleTransferToken()
    transferTokenBtn.textContent = t('wallet_action_transfer_token');

    const backBtn = $Id("wallet-back-btn") as HTMLButtonElement;
    backBtn.onclick = async () => {
        showView('#onboarding/main-home', dashRouter);
    }

    const signOutBtn = $Id("btn-sign-out") as HTMLButtonElement;
    signOutBtn.textContent = t('wallet_action_sign_out');
    signOutBtn.onclick = async () => {
        await doSignOut();
        await initWalletOrCreate();
    }
}

export async function initWalletOrCreate(): Promise<void> {
    const walletCreateDiv = $Id("wallet-create-div") as HTMLButtonElement;//btn-create-wallet
    const walletInfoDiv = $Id("wallet-info-area") as HTMLDivElement;
    const walletSettingBtn = $Id("wallet-settings-btn") as HTMLButtonElement;
    const walletMenuBtn = $Id("btn-main-menu") as HTMLButtonElement;
    const walletMainMenu = $Id("wallet-main-menu") as HTMLDivElement;

    walletMainMenu.onclick = () => {
        if (walletMainMenu && !walletMainMenu.classList.contains("hidden")) {
            walletMainMenu.classList.add("hidden");
        }
    }

    await initSettingsPanel();

    const address = await getWalletAddress();
    const walletConnectBtn = (walletCreateDiv.querySelector(".btn-create-wallet") as HTMLButtonElement);
    walletConnectBtn.textContent = t('cdp_wallet_connect');
    walletConnectBtn.onclick = async () => {
        const url = browser.runtime.getURL("html/cdp_auth.html");
        await showPopupWindow(url)
    };

    if (!address) {
        walletCreateDiv.style.display = "block";
        walletInfoDiv.style.display = "none";
    } else {
        walletCreateDiv.style.display = "none";
        walletInfoDiv.style.display = "block";
        const addressSpan = walletInfoDiv.querySelector(".wallet-address-value") as HTMLSpanElement;
        addressSpan.textContent = address;
        refreshBalances().then()
    }

    walletSettingBtn.onclick = () => {
        showView('#onboarding/wallet-setting', dashRouter);
    }

    walletMenuBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        walletMainMenu.classList.toggle("hidden");
    });

    document.addEventListener("click", (ev) => {
        hideWalletMenu(ev, walletMainMenu)
    });

    setupWalletActionButtons();
}

function hideWalletMenu(ev: PointerEvent, menu: HTMLElement) {
    const target = ev.target as Node | null;
    if (!target) return;

    // 已经是隐藏的，就不用处理了
    if (menu.classList.contains("hidden")) {
        return;
    }

    // 点在菜单内部：不关闭
    if (menu.contains(target)) {
        return;
    }

    // 点在按钮本身（或按钮里的 svg）：不关闭
    if (menu === target || menu.contains(target)) {
        return;
    }

    // 其它情况：关闭菜单
    menu.classList.add("hidden");
}


interface TransferEthFormValues {
    to: string;
    amount: string;
    gas?: string;
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


