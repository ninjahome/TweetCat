import {
    API_PATH_ADS_CREATE,
    adsWorkerFetch,
    getCurrentXId,
    getCurrentXUserName,
    initWalletInfo,
    publisherState
} from "./ad_publisher_common";
import {
    updateBudgetSummaryAndBalance,
    refreshAdsData,
    fetchDashboardInfo
} from "./ad_publisher_dashboard";
import { showNotification, usdcToAtomic, atomicToUsdcNumber, formatUSDC, formatUSDCTrimmed, showLoading, hideLoading, $Id } from "../common";
import { t } from "../../common/i18n";


// ========= 发布广告（简化版 MVP - 仅 Follow） =========

function resetPublishForm() {
    const nameInput = $Id("ad-name") as HTMLInputElement | null;
    const rewardInput = $Id("reward-amount") as HTMLInputElement | null;
    const taskLimitInput = $Id("task-limit") as HTMLInputElement | null;
    const endDateInput = $Id("end-date") as HTMLInputElement | null;
    const targetUrlInput = $Id("target-url") as HTMLInputElement | null;

    if (nameInput) nameInput.value = "";
    if (rewardInput) rewardInput.value = "";
    if (taskLimitInput) taskLimitInput.value = "";
    if (endDateInput) endDateInput.value = "";
    if (targetUrlInput) targetUrlInput.value = "";
}

function closePublishModal() {
    const modal = $Id("publish-wizard-modal");
    if (modal) modal.classList.remove("active");
}

async function openPublishModal() {
    if (!publisherState?.walletInfoCache?.hasCreated || !publisherState?.walletInfoCache?.xId) {
        showLoading(t("checking_login_status") || "Checking login status...");
        try {
            await initWalletInfo();
        } catch (err: any) {
            showNotification(err?.message || "Please sign in and create wallet first.", "error");
            return;
        } finally {
            hideLoading();
        }
    }

    resetPublishForm();
    updateBudgetSummaryAndBalance();

    // Auto specific default target url
    const currentXId = getCurrentXId();
    const targetUrlInput = $Id("target-url") as HTMLInputElement | null;

    if (targetUrlInput && currentXId) {
        try {
            const userName = getCurrentXUserName();
            if (userName) {
                targetUrlInput.value = `https://x.com/${userName}`;
            } else {
                targetUrlInput.value = `https://x.com/i/user/${currentXId}`;
            }
        } catch {
            targetUrlInput.value = `https://x.com/i/user/${currentXId}`;
        }
    }

    const modal = $Id("publish-wizard-modal");
    if (modal) modal.classList.add("active");
}

/**
 * 提交发布表单（MVP 简化版：仅 Follow 类型）
 */
async function submitPublishForm() {
    const submitBtn = $Id("btn-wizard-submit") as HTMLButtonElement | null;
    if (submitBtn) submitBtn.disabled = true;
    showLoading(t("publishing_campaign"));

    try {
        const currentXId = getCurrentXId();

        const nameInput = $Id("ad-name") as HTMLInputElement | null;
        const rewardInput = $Id("reward-amount") as HTMLInputElement | null;
        const taskLimitInput = $Id("task-limit") as HTMLInputElement | null;
        const endDateInput = $Id("end-date") as HTMLInputElement | null;

        const name = nameInput?.value?.trim() || "";
        const reward = rewardInput?.value || "";
        const quotaTotal = Number(taskLimitInput?.value || "0");
        const endDateStr = endDateInput?.value || "";
        const targetUrlInput = $Id("target-url") as HTMLInputElement | null;
        const detailUrl = targetUrlInput?.value?.trim() || "";

        // 校验必填字段
        if (!name) {
            showNotification(t("err_enter_campaign_name"), "error");
            return;
        }

        if (!detailUrl) {
            showNotification(t("err_enter_target_url"), "error");
            return;
        }

        const rewardNum = parseFloat(reward);
        if (isNaN(rewardNum) || rewardNum <= 0) {
            showNotification(t("err_reward_positive"), "error");
            return;
        }

        if (isNaN(quotaTotal) || !Number.isInteger(quotaTotal) || quotaTotal <= 0) {
            showNotification(t("err_quota_positive"), "error");
            return;
        }

        if (!endDateStr) {
            showNotification(t("err_select_end_date"), "error");
            return;
        }

        const endDate = new Date(`${endDateStr}T23:59:59`);
        if (isNaN(endDate.getTime()) || endDate <= new Date()) {
            showNotification(t("err_end_date_future"), "error");
            return;
        }

        const unitPriceAtomic = usdcToAtomic(reward);
        if (!unitPriceAtomic) {
            showNotification(t("err_invalid_reward_format"), "error");
            return;
        }

        // MVP: 只需要核心字段，后端自动填充 title/description/detail_url
        const payload = {
            a_x_id: currentXId,
            name,
            unit_price_atomic: unitPriceAtomic,
            quota_total: quotaTotal,
            end_date: endDate.toISOString(),
            detail_url: detailUrl,
        };

        console.log("[ads][create] payload", payload);
        const result = await adsWorkerFetch(API_PATH_ADS_CREATE, payload);

        if (!result.ok) {
            showNotification(result.error?.detail || result.error?.message || t("err_failed_create_campaign"), "error");
            return;
        }

        showNotification(t("msg_campaign_published"), "success");
        closePublishModal();
        await fetchDashboardInfo();
        await refreshAdsData(1);
        resetPublishForm();
    } catch (e: any) {
        console.error("[ads][create] failed", e);
        let msg = (e?.message || t("err_failed_create_campaign")).toString();

        // Handle technical "Insufficient Balance" technical message from x402WorkerFetch
        if (msg.includes("INSUFFICIENT_BALANCE")) {
            // Reformat atomic string "Required 1000000, available 0" to USDC
            const match = msg.match(/Required (\d+), available (\d+)/);
            let detail = "";
            if (match) {
                const req = formatUSDCTrimmed(atomicToUsdcNumber(match[1]));
                const avail = formatUSDCTrimmed(atomicToUsdcNumber(match[2]));
                detail = `${t("required_label")} ${req}, ${t("available_label")} ${avail}.`;
            }
            showNotification(`${t("err_insufficient_balance")} ${detail}`.trim(), "error");
            return;
        }

        showNotification(msg, "error");
    } finally {
        if (submitBtn) submitBtn.disabled = false;
        hideLoading();
    }
}

export function initWizardEvents() {
    // 关闭按钮
    const closeWizardBtn = $Id("close-wizard") as HTMLButtonElement | null;
    if (closeWizardBtn) closeWizardBtn.addEventListener("click", closePublishModal);

    // 打开发布弹窗
    const btnPublish = $Id("btn-publish-ad") as HTMLButtonElement | null;
    if (btnPublish) btnPublish.addEventListener("click", openPublishModal);

    // 提交按钮
    const btnSubmit = $Id("btn-wizard-submit") as HTMLButtonElement | null;
    if (btnSubmit) btnSubmit.addEventListener("click", submitPublishForm);

    // 实时计算预算摘要
    const rewardAmount = $Id("reward-amount") as HTMLInputElement | null;
    if (rewardAmount) {
        rewardAmount.addEventListener("input", () => {
            // Enforce max 6 decimal places
            const val = rewardAmount.value;
            if (val.includes('.')) {
                const parts = val.split('.');
                if (parts[1].length > 6) {
                    rewardAmount.value = parts[0] + '.' + parts[1].substring(0, 6);
                }
            }
            updateBudgetSummaryAndBalance();
        });
    }

    const taskLimit = $Id("task-limit") as HTMLInputElement | null;
    if (taskLimit) taskLimit.addEventListener("input", updateBudgetSummaryAndBalance);
}
