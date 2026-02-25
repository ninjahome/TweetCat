import {
    API_PATH_ADS_CREATE,
    getCurrentXId,
    getCurrentXUserName
} from "./ad_publisher_common";
import {
    updateBudgetSummaryAndBalance,
    refreshAdsData,
    fetchDashboardInfo
} from "./ad_publisher_dashboard";
import { showNotification, usdcToAtomic, atomicToUsdcNumber, formatUSDC, showLoading, hideLoading, $Id } from "../common";
import { x402WorkerFetch } from "../../wallet/cdp_wallet";


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
    showLoading("Publishing campaign...");

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
            showNotification("Please enter a campaign name.", "error");
            return;
        }

        if (!detailUrl) {
            showNotification("Please enter a target Twitter profile URL.", "error");
            return;
        }

        const rewardNum = parseFloat(reward);
        if (isNaN(rewardNum) || rewardNum <= 0) {
            showNotification("Reward per follow must be greater than 0.", "error");
            return;
        }

        if (isNaN(quotaTotal) || !Number.isInteger(quotaTotal) || quotaTotal <= 0) {
            showNotification("Max followers must be a positive integer.", "error");
            return;
        }

        if (!endDateStr) {
            showNotification("Please select an end date.", "error");
            return;
        }

        const endDate = new Date(`${endDateStr}T23:59:59`);
        if (isNaN(endDate.getTime()) || endDate <= new Date()) {
            showNotification("End date must be in the future.", "error");
            return;
        }

        const unitPriceAtomic = usdcToAtomic(reward);
        if (!unitPriceAtomic) {
            showNotification("Invalid reward amount format.", "error");
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
        const result = await x402WorkerFetch(API_PATH_ADS_CREATE, payload);

        if (!result.ok) {
            showNotification(result.error?.detail || result.error?.message || "Failed to create campaign.", "error");
            return;
        }

        showNotification("Campaign published successfully!", "success");
        closePublishModal();
        await fetchDashboardInfo();
        await refreshAdsData(1);
        resetPublishForm();
    } catch (e: any) {
        console.error("[ads][create] failed", e);
        let msg = (e?.message || "Failed to create campaign.").toString();

        // Handle technical "Insufficient Balance" technical message from x402WorkerFetch
        if (msg.includes("INSUFFICIENT_BALANCE")) {
            // Reformat atomic string "Required 1000000, available 0" to USDC
            const match = msg.match(/Required (\d+), available (\d+)/);
            let detail = "";
            if (match) {
                const req = formatUSDC(atomicToUsdcNumber(match[1]));
                const avail = formatUSDC(atomicToUsdcNumber(match[2]));
                detail = `Required ${req}, available ${avail}.`;
            }
            showNotification(`余额不足. ${detail}`.trim(), "error");
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
    if (rewardAmount) rewardAmount.addEventListener("input", updateBudgetSummaryAndBalance);

    const taskLimit = $Id("task-limit") as HTMLInputElement | null;
    if (taskLimit) taskLimit.addEventListener("input", updateBudgetSummaryAndBalance);
}
