import {
    $Id, $input, FIXED_ETH_TRANSFER_GAS_ETH,
    FIXED_MINI_USDC_TRANSFER, hideLoading, showAlert, showLoading, showNotification, showPopupWindow, x402WorkerGet
} from "./common";
import {t} from "../common/i18n";
import {ethers} from "ethers";
import {showView} from "../common/utils";
import {dashRouter} from "./dashboard";
import browser from "webextension-polyfill";
import {currentSettings, getReadableNetworkName} from "./dash_setting";
import {
    ChainIDBaseMain,
    ChainIDBaseSepolia,
    ChainNameBaseMain,
    doSignOut,
    walletInfo,
    X402_FACILITATORS
} from "../common/x402_obj";
import {
    getWalletAddress, queryCdpUserID,
    queryCdpWalletInfo,
    transferETHEoa, transferUSDCByX402
} from "../wallet/cdp_wallet";
import {getChainId} from "../wallet/wallet_setting";

function parseTransVal(toInput: HTMLInputElement, amountInput: HTMLInputElement) {
    const to = toInput.value.trim();
    const amount = amountInput.value.trim();

    if (!to) {
        return {err: t("wallet_error_to_required")};
    }
    if (!ethers.utils.isAddress(to)) {
        return {err: t("wallet_error_invalid_to_address")};
    }

    if (!amount) {
        return {err: t("wallet_error_amount_required")};
    }

    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) {
        return {err: t("wallet_error_amount_required")};
    }
    return {to, amount}
}

function openTransferDialog(typ: "eth" | "usdc", wi: walletInfo): Promise<TransferValues | null> {

    return new Promise<TransferValues | null>((resolve) => {
        const isEth = typ === "eth"

        const modal = $Id("transfer-modal") as HTMLDivElement;
        modal.classList.remove("hidden");

        const transferTitle = $Id('transfer-title');
        transferTitle.textContent = isEth ? t('wallet_transfer_eth_title') : t('wallet_transfer_token_title');

        const closeBtn = $Id("transfer-close-btn") as HTMLButtonElement;
        closeBtn.onclick = () => handleClose(null);
        const errorEl = $Id("transfer-error") as HTMLParagraphElement

        const handleClose = (result: TransferValues | null) => {
            toInput.value = "";
            amountInput.value = "";
            errorEl.textContent = "";
            modal.classList.add("hidden");
            resolve(result);
        }

        const form = $Id("transfer-form") as HTMLFormElement;
        form.onsubmit = (ev: Event) => {
            ev.preventDefault();
            errorEl.textContent = "";
            const {to, amount, err} = parseTransVal(toInput, amountInput)
            if (err) {
                errorEl.textContent = err;
                return
            }
            handleClose({to, amount})
        };

        $Id('transfer-to-label').textContent = t('wallet_transfer_to_label');
        const toInput = $input("#transfer-to");
        $Id('transfer-to-hint').textContent = t('wallet_transfer_to_hint');

        $Id('transfer-amount-label').textContent = t('wallet_transfer_amount_label');
        const amountInput = $input("#transfer-amount");
        const val = isEth ? wi.ethVal + "  ETH" : wi.usdcVal + " USDC"
        $Id("transfer-balance").textContent = `${t("wallet_current_balance") || ""}：${val}`;
        $Id("tc-field__suffix").textContent = isEth ? "ETH" : "USDC"

        const maxBtn = $Id("transfer-fill-max") as HTMLButtonElement;
        maxBtn.onclick = async () => {
            const wi = await queryCdpWalletInfo(networkNameToId())
            if (!wi.hasCreated) return
            amountInput.value = isEth ? wi.ethVal : wi.usdcVal;
        }

        $Id("transfer-network-label").textContent = getReadableNetworkName();

        const cancelBtn = $Id("transfer-cancel-btn") as HTMLButtonElement;
        cancelBtn.textContent = t('cancel');
        cancelBtn.onclick = () => handleClose(null);

        $Id('transfer-submit-btn').textContent = t('wallet_transfer_confirm_btn');
    });
}

async function __handleTransfer(typ: "eth" | "usdc", action: (chain: number, receipt: string, amount: string) => Promise<`0x${string}`>): Promise<void> {
    showLoading(t("syncing") || "");
    try {
        const wi = await queryCdpWalletInfo(networkNameToId())
        if (!wi.hasCreated) {
            showAlert(t('tips_title'), t('wallet_error_no_wallet'))
            return
        }

        if (typ === "eth" && Number(wi.ethVal) < FIXED_ETH_TRANSFER_GAS_ETH) {
            showAlert(t('tips_title'), t('wallet_error_gas_invalid'))
            return
        }

        if (typ === "usdc" && Number(wi.usdcVal) < FIXED_MINI_USDC_TRANSFER) {
            showAlert(t('tips_title'), t('wallet_insufficient_funds') + "(Minimum:" + FIXED_MINI_USDC_TRANSFER + ")")
            return
        }

        hideLoading()
        const formValues = await openTransferDialog(typ, wi);
        if (!formValues) {
            return;
        }
        showLoading(t("wallet_sending_transaction") || "");
        const {to, amount} = formValues;
        const chainID = await getChainId()
        const hash = await action(chainID, to, amount)
        browser.tabs.create({url: X402_FACILITATORS[chainID].browser + "/tx/" + hash}).then()
        refreshBalances(false).then();
    } catch (error) {
        console.log(error)
        showNotification(
            (error as Error).message ?? t("wallet_transfer_failed"),
            "error",
        );
    } finally {
        hideLoading()
    }
}

function networkNameToId(): number {
    return currentSettings.network === ChainNameBaseMain ? ChainIDBaseMain : ChainIDBaseSepolia
}

export async function refreshBalances(showStatus = true): Promise<void> {
    const ethSpan = document.querySelector(".wallet-eth-value") as HTMLSpanElement | null;
    const usdcSpan = document.querySelector(".wallet-usdt-value") as HTMLSpanElement | null;

    try {
        if (showStatus) showNotification(t('wallet_refreshing_balance'));
        const walletInfo = await queryCdpWalletInfo(networkNameToId())
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

function setupWalletActionButtons(): void {
    const refreshBtn = $Id("btn-refresh-balance") as HTMLButtonElement;
    refreshBtn.textContent = t('wallet_action_refresh_balance');
    refreshBtn.onclick = async () => refreshBalances()


    const showBtn = $Id("btn-show-on-browser") as HTMLButtonElement;
    showBtn.textContent = t('wallet_action_show_on_browser');
    showBtn.onclick = async () => showBalanceOnBrowser()

    const transferEthBtn = $Id("btn-transfer-eth") as HTMLButtonElement;
    transferEthBtn.textContent = t('wallet_action_transfer_eth');
    transferEthBtn.onclick = async () => __handleTransfer("eth", transferETHEoa)

    const transferTokenBtn = $Id("btn-transfer-token");
    transferTokenBtn.onclick = async () => __handleTransfer("usdc", transferUSDCByX402)
    transferTokenBtn.textContent = t('wallet_action_transfer_token');

    const backBtn = $Id("wallet-back-btn") as HTMLButtonElement;
    backBtn.onclick = async () => {
        showView('#onboarding/main-home', dashRouter);
    }

    const signOutBtn = $Id("btn-sign-out") as HTMLButtonElement;
    signOutBtn.textContent = t('wallet_action_sign_out');
    signOutBtn.onclick = async () => {
        await browser.offscreen.closeDocument();
        await doSignOut();
        initWalletOrCreate();
    }

    // Fee History 按钮
    const feeHistoryBtn = $Id("btn-fee-history") as HTMLButtonElement;
    if (feeHistoryBtn) {
        feeHistoryBtn.onclick = async () => {
            await browser.tabs.create({
                url: browser.runtime.getURL("html/fees.html")
            });
        };
    }

    console.log("----------->>>>> wallet action init success!!!!!!")
}

export function initWalletOrCreate() {
    initRewards().then()
    const walletCreateDiv = $Id("wallet-create-div") as HTMLButtonElement;//btn-create-wallet
    const walletInfoDiv = $Id("wallet-info-area") as HTMLDivElement;
    const walletMainMenu = $Id("wallet-main-menu") as HTMLDivElement;

    walletMainMenu.onclick = () => {
        if (walletMainMenu && !walletMainMenu.classList.contains("hidden")) {
            walletMainMenu.classList.add("hidden");
        }
    }

    getWalletAddress().then((address => {
        if (!address) {
            walletCreateDiv.style.display = "block";
            walletInfoDiv.style.display = "none";
        } else {
            walletCreateDiv.style.display = "none";
            walletInfoDiv.style.display = "block";
            const addressSpan = walletInfoDiv.querySelector(".wallet-address-value") as HTMLSpanElement;
            addressSpan.textContent = address;
            refreshBalances(false).then()
        }
    }));

    const walletConnectBtn = (walletCreateDiv.querySelector(".btn-create-wallet") as HTMLButtonElement);
    walletConnectBtn.textContent = t('cdp_wallet_connect');
    walletConnectBtn.onclick = async () => {
        const url = browser.runtime.getURL("html/cdp_auth_auto_x.html");
        await showPopupWindow(url)
    };

    $Id("wallet-settings-btn").onclick = () => {
        showView('#onboarding/wallet-setting', dashRouter);
    }

    $Id("btn-main-menu").onclick = (ev) => {
        ev.stopPropagation();
        walletMainMenu.classList.toggle("hidden");
    }

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


interface TransferValues {
    to: string;
    amount: string;
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

    const feeHistoryLabel = $Id('wallet-action-fee-history-label');
    if (feeHistoryLabel) feeHistoryLabel.textContent = t('wallet_action_fee_history') || '平台费用';

    // 网络选择
    const networkTitle = $Id('wallet-network-title');
    if (networkTitle) networkTitle.textContent = t('wallet_network_title');

    const networkSelectLabel = $Id('wallet-network-select-label');
    if (networkSelectLabel) networkSelectLabel.textContent = t('wallet_network_select_label');

    const networkOptionMain = $Id('wallet-network-option-base-mainnet');
    if (networkOptionMain) networkOptionMain.textContent = t('wallet_network_option_base_mainnet');

    const networkOptionSepolia = $Id('wallet-network-option-base-sepolia');
    if (networkOptionSepolia) networkOptionSepolia.textContent = t('wallet_network_option_base_sepolia');

}


// 奖励数据接口
interface ValidRewardsResponse {
    success: boolean;
    data: {
        rewards: Array<{
            id: number;
            cdp_user_id: string;
            asset_symbol: string;
            amount_atomic: string;
            status: number;
            [key: string]: any;
        }>;
        totalAmount: string;
        count: number;
    };
}

async function initRewards(): Promise<void> {
    const rewardsArea = $Id("rewards-area") as HTMLElement;

    // 设置静态文本
    const rewardsTitle = rewardsArea.querySelector(".rewards-title") as HTMLElement;
    if (rewardsTitle) {
        rewardsTitle.textContent = t('dashboard_rewards_title');
    }

    const rewardsLabels = rewardsArea.querySelectorAll(".rewards-label");
    if (rewardsLabels[0]) {
        rewardsLabels[0].textContent = t('dashboard_rewards_pending');
    }

    try {
        const cdpUserId = await queryCdpUserID();
        if (!cdpUserId) {
            // 没有用户ID，隐藏奖励区域
            rewardsArea.style.display = "none";
            return;
        }

        const response: ValidRewardsResponse = await x402WorkerGet("/rewards/query_valid", {
            cdp_user_id: cdpUserId
        });

        if (response.success && response.data) {
            const {rewards} = response.data;
            const rewardsCount = rewardsArea.querySelector(".rewards-count") as HTMLElement;
            const rewardsAmount = rewardsArea.querySelector(".rewards-amount") as HTMLElement;

            // 计算 USDC 总额
            let totalUSDC = 0;
            rewards.forEach(reward => {
                if (reward.asset_symbol === "USDC") {
                    totalUSDC += Number(reward.amount_atomic) / 1e6; // 精度为6
                }
            });

            // 更新界面
            rewardsCount.textContent = rewards.length.toString();
            rewardsAmount.textContent = totalUSDC.toFixed(2);

            // 显示奖励区域
            rewardsArea.style.display = "block";

            // 绑定点击事件
            rewardsArea.onclick = async () => {
                const status = rewards.length > 0 ? 0 : -1;
                await browser.tabs.create({
                    url: browser.runtime.getURL(`html/rewards.html?status=${status}`)
                });
            };
        } else {
            // API 返回失败，隐藏奖励区域
            rewardsArea.style.display = "none";
        }
    } catch (error) {
        console.error("获取奖励信息失败:", error);
        // 发生错误时，隐藏奖励区域
        rewardsArea.style.display = "none";
    }
}
