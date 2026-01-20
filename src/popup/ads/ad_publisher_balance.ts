import {$Id, atomicToUsdcNumber, formatUSDC, openTxInExplorer, showNotification} from "../common";
import {normalizeWalletUsdcDisplay, parseUsdcNumber, publisherState, updateHeaderInfo} from "./ad_publisher_common";
import {refreshAdsData} from "./ad_publisher_dashboard";
import {postToX402SrvByPri, queryCdpWalletInfo, x402WorkerFetch} from "../../wallet/cdp_wallet";
import {getChainId} from "../../wallet/wallet_setting";

type TransferDirection = "wallet_to_ads" | "ads_to_wallet";
let transferDirection: TransferDirection = "wallet_to_ads";
let isTransferBusy = false;

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
    isTransferBusy = isBusy;

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
    if (adsAvail) adsAvail.textContent = formatUSDC(atomicToUsdcNumber(publisherState.adAccountInfo.balanceAtomic));

    const adsFrozen = $Id("transfer-ads-frozen");
    if (adsFrozen) adsFrozen.textContent = formatUSDC(atomicToUsdcNumber(publisherState.adAccountInfo.frozenAtomic ?? "0"));

    const amountInput = $Id("transfer-amount") as HTMLInputElement | null;
    if (amountInput) amountInput.value = "";
}

export function openRechargeModal() {
    const modal = $Id("recharge-modal");
    if (modal) modal.classList.add("active");

    syncTransferModalUI();
    setTransferDirection("wallet_to_ads");
    setTransferInlineError(null);

    const limitDetails = $Id("monthly-limit-details");
    if (limitDetails) {
        limitDetails.classList.add("hidden");
        const viewTxBtn = $Id("btn-view-previous-tx") as HTMLButtonElement | null;
        if (viewTxBtn) {
            viewTxBtn.classList.add("hidden");
            viewTxBtn.onclick = null;
        }
    }
}

function closeRechargeModal() {
    const modal = $Id("recharge-modal");
    if (modal) modal.classList.remove("active");
}

async function refreshWalletAndAdsUI(): Promise<void> {
    const chainId = await getChainId();
    publisherState.walletInfoCache = await queryCdpWalletInfo(chainId);
    updateHeaderInfo();
    await refreshAdsData();
    syncTransferModalUI();
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
        const maxAds = atomicToUsdcNumber(publisherState.adAccountInfo.balanceAtomic);
        if (amount > maxAds + 1e-9) throw new Error("Amount exceeds Ads Available.");
    }

    return {a_x_id: publisherState.walletInfoCache.xId, amount: amount.toFixed(2)};
}

async function handleAdsEscrowTransfer(): Promise<void> {
    setTransferInlineError("");

    try {
        const payload = prepareEscrowTransferParam();
        let result: any;

        if (transferDirection === "wallet_to_ads") {
            setTransferBusy(true, "Processing deposit...");
            result = await postToX402SrvByPri("/ads/publisher/recharge", payload);
        } else {
            setTransferBusy(true, "Processing withdraw...");
            result = await x402WorkerFetch("/ads/publisher/withdraw", payload);
        }

        if (transferDirection === "ads_to_wallet" && result.alreadyWithdrawn === true) {
            handleMonthlyWithdrawLimitIfNeeded(result);
            return;
        }

        const limitDetails = $Id("monthly-limit-details");
        if (limitDetails) limitDetails.classList.add("hidden");

        if (!result.success || !result.txHash) {
            const msg = (result.detail || result.message || result.error || "Invalid response").toString();
            setTransferInlineError(msg);
            showNotification(msg, "error");
            return;
        }

        const txHash = String(result.txHash);

        closeRechargeModal();
        await openTxInExplorer(txHash);
        refreshWalletAndAdsUI().then();
        showNotification("Transfer submitted successfully.", "success");
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
                : atomicToUsdcNumber(publisherState.adAccountInfo.balanceAtomic);

        input.value = Math.max(0, max).toFixed(2);
    });

    const btnSubmit = $Id("btn-transfer-submit") as HTMLButtonElement | null;
    if (btnSubmit) {
        btnSubmit.onclick = () => {
            void handleAdsEscrowTransfer();
        };
    }
}
