import {
    $Id,
    atomicToUsdcNumber,
    formatUSDC,
    openTxInExplorer,
    showNotification
} from "../common";
import {
    API_PATH_ADS_PUBLISHER_RECHARGE,
    API_PATH_ADS_PUBLISHER_WITHDRAW,
    initWalletInfo,
    normalizeWalletUsdcDisplay,
    parseUsdcNumber,
    publisherState
} from "./ad_publisher_common";
import { fetchDashboardInfo, loadAndRenderTransferHistory } from "./ad_publisher_dashboard";
import { postToX402Srv, x402WorkerFetch } from "../../wallet/cdp_wallet";

type TransferDirection = "wallet_to_ads" | "ads_to_wallet";
let transferDirection: TransferDirection = "wallet_to_ads";

function setTransferInlineError(message: string | null): void {
    const inlineError = $Id("transfer-inline-error");
    const errorText = $Id("error-message-text");
    if (!inlineError) return;

    if (!message) {
        if (errorText) errorText.textContent = "";
        inlineError.classList.add("hidden");
        return;
    }

    if (errorText) errorText.textContent = message;
    inlineError.classList.remove("hidden");
}

function setTransferBusy(isBusy: boolean, label?: string): void {

    const overlay = $Id("loading-overlay");
    if (overlay) overlay.style.display = isBusy ? "flex" : "none";

    const controls: Array<HTMLInputElement | HTMLButtonElement | null> = [
        $Id("btn-transfer-submit") as HTMLButtonElement | null,
        $Id("transfer-amount") as HTMLInputElement | null,
        $Id("transfer-max") as HTMLButtonElement | null,
        $Id("transfer-dir-wallet-to-ads") as HTMLButtonElement | null,
        $Id("transfer-dir-ads-to-wallet") as HTMLButtonElement | null,
        $Id("close-recharge") as HTMLButtonElement | null,
    ];

    controls.forEach((control) => {
        if (!control) return;
        control.disabled = isBusy;
    });

    const submitBtn = $Id("btn-transfer-submit") as HTMLButtonElement | null;
    if (submitBtn) {
        if (isBusy) {
            submitBtn.dataset.defaultLabel = submitBtn.textContent || "";
            if (label) submitBtn.textContent = label;
        } else if (submitBtn.dataset.defaultLabel) {
            submitBtn.textContent = submitBtn.dataset.defaultLabel;
        }
    }
}

function setTransferDirection(dir: TransferDirection) {
    transferDirection = dir;

    const btnA = $Id("transfer-dir-wallet-to-ads");
    const btnB = $Id("transfer-dir-ads-to-wallet");
    btnA?.classList.toggle("active", dir === "wallet_to_ads");
    btnB?.classList.toggle("active", dir === "ads_to_wallet");

    const submitBtn = $Id("btn-transfer-submit") as HTMLButtonElement | null;
    if (submitBtn) submitBtn.textContent = dir === "wallet_to_ads" ? "Transfer to Ads" : "Transfer to Wallet";

    const indicator = $Id("transfer-direction-indicator");
    if (indicator) {
        indicator.textContent =
            dir === "wallet_to_ads"
                ? "On-chain Wallet → Ads Account"
                : "Ads Account → On-chain Wallet";
    }

    const monthlyWarning = $Id("monthly-limit-warning");
    if (monthlyWarning) {
        if (dir === "ads_to_wallet") monthlyWarning.classList.remove("hidden");
        else monthlyWarning.classList.add("hidden");
    }

    const limitDetails = $Id("monthly-limit-details");
    if (limitDetails) {
        limitDetails.classList.add("hidden");

        // 完备性补充：如果切换到提现模式，主动检查本月是否已提现
        if (dir === "ads_to_wallet" && publisherState.dashboardInfo.last_withdraw_at) {
            const lastWithdraw = new Date(publisherState.dashboardInfo.last_withdraw_at);
            const now = new Date();

            // 检查是否在同一个月
            if (lastWithdraw.getFullYear() === now.getFullYear() && lastWithdraw.getMonth() === now.getMonth()) {
                limitDetails.classList.remove("hidden");

                // 设置详情信息
                const prevDateEl = $Id("previous-withdraw-date");
                if (prevDateEl) prevDateEl.textContent = lastWithdraw.toLocaleString();

                // 计算下月 1 号
                const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
                const nextDateEl = $Id("next-available-date");
                if (nextDateEl) nextDateEl.textContent = nextMonth.toLocaleDateString();

                // 禁用提交按钮（可选，但更完备）
                const submitBtn = $Id("btn-transfer-submit") as HTMLButtonElement | null;
                if (submitBtn) {
                    submitBtn.disabled = true;
                    submitBtn.title = "Monthly withdrawal limit reached";
                }
            }
        } else {
            // 恢复提交按钮状态
            const submitBtn = $Id("btn-transfer-submit") as HTMLButtonElement | null;
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.title = "";
            }
        }

        const viewTxBtn = $Id("btn-view-previous-tx") as HTMLButtonElement | null;
        if (viewTxBtn) {
            viewTxBtn.classList.add("hidden");
            viewTxBtn.onclick = null;
        }
    }

    setTransferInlineError(null);
}

function syncTransferModalUI() {
    const walletBal = $Id("transfer-wallet-balance");
    if (walletBal) walletBal.textContent = normalizeWalletUsdcDisplay(publisherState.walletInfoCache?.usdcVal ?? "0.00");

    const adsAvail = $Id("transfer-ads-available");
    if (adsAvail) adsAvail.textContent = formatUSDC(atomicToUsdcNumber(publisherState.dashboardInfo.balance_atomic));

    const adsFrozen = $Id("transfer-ads-frozen");
    if (adsFrozen) adsFrozen.textContent = formatUSDC(atomicToUsdcNumber(publisherState.dashboardInfo.frozen_atomic ?? "0"));

    const amountInput = $Id("transfer-amount") as HTMLInputElement | null;
    if (amountInput) amountInput.value = "";
}

export function openRechargeModal() {
    const modal = $Id("recharge-modal");
    if (modal) modal.classList.add("active");

    syncTransferModalUI();
    setTransferDirection("wallet_to_ads");
}

function closeRechargeModal() {
    const modal = $Id("recharge-modal");
    if (modal) modal.classList.remove("active");

    // Clear state
    setTransferInlineError(null);
    const limitDetails = $Id("monthly-limit-details");
    if (limitDetails) limitDetails.classList.add("hidden");

    // Clear amount
    const amountInput = $Id("transfer-amount") as HTMLInputElement | null;
    if (amountInput) amountInput.value = "";
}


function handleMonthlyWithdrawLimitIfNeeded(result: any) {
    if (!result || result.alreadyWithdrawn !== true) return;

    setTransferInlineError(null);

    const limitDetails = $Id("monthly-limit-details");
    if (limitDetails) {
        limitDetails.classList.remove("hidden");

        if (result.withdrawnAt) {
            const withdrawDate = new Date(result.withdrawnAt).toLocaleString();
            const prevDateEl = $Id("previous-withdraw-date");
            if (prevDateEl) prevDateEl.textContent = withdrawDate;
        }

        if (result.nextAvailableDate) {
            const nextDate = new Date(result.nextAvailableDate).toLocaleDateString();
            const nextDateEl = $Id("next-available-date");
            if (nextDateEl) nextDateEl.textContent = nextDate;
        }

        const viewTxBtn = $Id("btn-view-previous-tx") as HTMLButtonElement | null;
        if (viewTxBtn) {
            if (result.previousTxHash) {
                viewTxBtn.classList.remove("hidden");
                viewTxBtn.onclick = () => openTxInExplorer(result.previousTxHash);
            } else {
                viewTxBtn.classList.add("hidden");
                viewTxBtn.onclick = null;
            }
        }
    }

    const nextDateText = result.nextAvailableDate
        ? new Date(result.nextAvailableDate).toLocaleDateString()
        : "next month";
    showNotification(`Monthly withdrawal limit reached. Next available: ${nextDateText}`, "error");
}

function prepareEscrowTransferParam(): any {
    const input = $Id("transfer-amount") as HTMLInputElement | null;
    const amount = Number((input?.value || "0").trim());

    if (!Number.isFinite(amount) || amount <= 0) throw new Error("Please enter a valid amount.");
    if (!publisherState.walletInfoCache?.xId) throw new Error("Missing user xId. Please sign in again.");

    if (transferDirection === "ads_to_wallet") {
        const maxAds = atomicToUsdcNumber(publisherState.dashboardInfo.balance_atomic);
        if (amount > maxAds + 1e-9) throw new Error("Amount exceeds Ads Available.");
    } else if (transferDirection === "wallet_to_ads") {
        const walletUsdc = parseUsdcNumber(publisherState.walletInfoCache?.usdcVal || "0");
        if (amount > walletUsdc + 1e-9) throw new Error("Amount exceeds Wallet Balance.");
    }

    return { a_x_id: publisherState.walletInfoCache.xId, amount: amount.toFixed(2) };
}

async function handleAdsEscrowTransfer(): Promise<void> {
    setTransferInlineError("");

    try {
        const payload = prepareEscrowTransferParam();
        let result: any;

        // Reset limit details before each submit attempt
        const limitDetails = $Id("monthly-limit-details");
        if (limitDetails) limitDetails.classList.add("hidden");

        console.log(`[Transfer] Initiating transfer: direction=${transferDirection}, amount=${payload.amount}`);

        if (transferDirection === "wallet_to_ads") {
            setTransferBusy(true, "Processing deposit...");
            result = await postToX402Srv(API_PATH_ADS_PUBLISHER_RECHARGE, payload);
        } else {
            setTransferBusy(true, "Processing withdraw...");
            // Use x402WorkerFetch for withdrawal as it should be a server-side treasury payout (no x402 payment from user)
            result = await x402WorkerFetch(API_PATH_ADS_PUBLISHER_WITHDRAW, payload);
        }

        console.log("[Transfer] API Response:", result);

        if (transferDirection === "ads_to_wallet" && result.alreadyWithdrawn === true) {
            handleMonthlyWithdrawLimitIfNeeded(result);
            return;
        }

        if (!result.success || !result.txHash) {
            const msg = (result.detail || result.message || result.error || "Invalid response").toString();
            setTransferInlineError(msg);
            showNotification(msg, "error");
            return;
        }

        const txHash = String(result.txHash);

        closeRechargeModal();
        showNotification("Transfer submitted successfully.", "success");

        // Refresh all balances and history
        await Promise.all([
            initWalletInfo(),
            fetchDashboardInfo(),
            loadAndRenderTransferHistory().catch(() => { }) // non-critical if modal not open
        ]);

        await openTxInExplorer(txHash);
    } catch (e: any) {
        const msg = (e?.message || "Transfer failed").toString();
        setTransferInlineError(msg);
        showNotification(msg, "error");
    } finally {
        setTransferBusy(false);
    }
}

export function initRechargeModalEvents() {
    const btnRecharge = $Id("btn-recharge") as HTMLButtonElement | null;
    if (btnRecharge) btnRecharge.addEventListener("click", openRechargeModal);

    const closeRecharge = $Id("close-recharge") as HTMLButtonElement | null;
    if (closeRecharge) closeRecharge.addEventListener("click", closeRechargeModal);

    const dirA = $Id("transfer-dir-wallet-to-ads") as HTMLButtonElement | null;
    if (dirA) dirA.addEventListener("click", () => setTransferDirection("wallet_to_ads"));

    const dirB = $Id("transfer-dir-ads-to-wallet") as HTMLButtonElement | null;
    if (dirB) dirB.addEventListener("click", () => setTransferDirection("ads_to_wallet"));

    const btnMax = $Id("transfer-max") as HTMLButtonElement | null;
    if (btnMax) btnMax.addEventListener("click", () => {
        const input = $Id("transfer-amount") as HTMLInputElement | null;
        if (!input) return;

        const max =
            transferDirection === "wallet_to_ads"
                ? parseUsdcNumber(publisherState.walletInfoCache?.usdcVal ?? "0")
                : atomicToUsdcNumber(publisherState.dashboardInfo.balance_atomic);

        input.value = Math.max(0, max).toFixed(2);
    });

    const btnSubmit = $Id("btn-transfer-submit") as HTMLButtonElement | null;
    if (btnSubmit) {
        btnSubmit.onclick = () => {
            void handleAdsEscrowTransfer();
        };
    }
}
