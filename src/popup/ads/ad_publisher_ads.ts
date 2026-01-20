import {
    getCurrentXUserName,
    isZeroAtomic
} from "./ad_publisher_common";
import {getCurrentXId} from "./ad_publisher_common";
import {updateBudgetSummaryAndBalance} from "./ad_publisher_dashboard";
import {
    $Id,
    showNotification, usdcToAtomic
} from "../common";
import {publisherState} from "./ad_publisher_common";
import {refreshAdsData} from "./ad_publisher_dashboard";
import {openRechargeModal} from "./ad_publisher_balance";
import {x402WorkerFetch, x402WorkerGet} from "../../wallet/cdp_wallet";

// ========= 发布广告向导（Wizard） =========
let wizardCurrentStep = 1;
const wizardMaxStep = 4;

function openWizard() {
    wizardCurrentStep = 1;
    updateWizardUI();
    const modal = $Id("publish-wizard-modal");
    if (modal) modal.classList.add("active");
}

function closeWizard() {
    const modal = $Id("publish-wizard-modal");
    if (modal) modal.classList.remove("active");
}

function updateWizardUI() {
    const steps = document.querySelectorAll<HTMLElement>(".wizard-step");
    steps.forEach((stepEl) => {
        const step = Number(stepEl.dataset.step);
        stepEl.classList.toggle("active", step === wizardCurrentStep);
        stepEl.classList.toggle("completed", step < wizardCurrentStep);
    });

    const contents = document.querySelectorAll<HTMLElement>(".wizard-content");
    contents.forEach((c) => {
        const step = Number(c.dataset.step);
        c.classList.toggle("active", step === wizardCurrentStep);
    });

    const prevBtn = $Id("btn-wizard-prev") as HTMLButtonElement | null;
    const nextBtn = $Id("btn-wizard-next") as HTMLButtonElement | null;
    const submitBtn = $Id("btn-wizard-submit") as HTMLButtonElement | null;

    if (prevBtn) prevBtn.style.display = wizardCurrentStep > 1 ? "inline-flex" : "none";
    if (nextBtn && submitBtn) {
        if (wizardCurrentStep < wizardMaxStep) {
            nextBtn.style.display = "inline-flex";
            submitBtn.style.display = "none";
        } else {
            nextBtn.style.display = "none";
            submitBtn.style.display = "inline-flex";
            updateBudgetSummaryAndBalance();
        }
    }
}

function goWizardNext() {
    // Step 1 validation: ad-category must be selected
    if (wizardCurrentStep === 1) {
        const adCategoryInput = document.querySelector<HTMLSelectElement>("#ad-category");
        const categoryValue = adCategoryInput?.value?.trim() || "";
        
        if (!categoryValue) {
            showNotification("Please select a category before proceeding.", "error");
            return;
        }
    }
    
    if (wizardCurrentStep < wizardMaxStep) {
        wizardCurrentStep++;
        updateWizardUI();
    }
}

function goWizardPrev() {
    if (wizardCurrentStep > 1) {
        wizardCurrentStep--;
        updateWizardUI();
    }
}

/**
 * ✅ 点击 Publish 按钮：先检查 Ads 余额；为 0 => 提示充值并打开 recharge-modal
 */
async function handlePublishClick(): Promise<void> {
    try {
        if (!publisherState.walletInfoCache?.xId) {
            showNotification("Please sign in first.", "error");
            return;
        }

        const xId = getCurrentXId();
        const balance = await x402WorkerGet("/ads/balance", {a_x_id: xId});

        publisherState.adAccountInfo = {
            balanceAtomic: balance?.balance_atomic ?? "0",
            frozenAtomic: balance?.frozen_atomic ?? "0",
        };

        if (isZeroAtomic(publisherState.adAccountInfo.balanceAtomic)) {
            showNotification("Balance is 0. Please recharge before publishing.", "error");
            openRechargeModal();
            return;
        }

        openWizard();
    } catch (e: any) {
        showNotification(e?.message || "Failed to check balance.", "error");
    }
}

async function submitWizard() {
    const currentXId = getCurrentXId();

    const nameInput = document.querySelector<HTMLInputElement>("#ad-name");
    const adCategoryInput = document.querySelector<HTMLSelectElement>("#ad-category");
    const adTitleInput = document.querySelector<HTMLInputElement>("#ad-title");
    const adDescriptionInput = document.querySelector<HTMLTextAreaElement>("#ad-description");
    const adImageInput = document.querySelector<HTMLInputElement>("#ad-image");
    const adUrlInput = document.querySelector<HTMLInputElement>("#ad-url");
    const rewardInput = document.querySelector<HTMLInputElement>("#reward-amount");
    const taskLimitInput = document.querySelector<HTMLInputElement>("#task-limit");
    const durationDaysInput = document.querySelector<HTMLInputElement>("#duration-days");
    const callbackUrlInput = document.querySelector<HTMLInputElement>("#callback-url");
    const customDataInput = document.querySelector<HTMLTextAreaElement>("#custom-data");

    const name = nameInput?.value?.trim() || "";
    const category = adCategoryInput?.value?.trim() || "";
    const title = adTitleInput?.value?.trim() || "";
    const description = adDescriptionInput?.value?.trim() || "";
    const imageUrl = adImageInput?.value?.trim() || null;
    const detailUrl = adUrlInput?.value?.trim() || "";
    const callbackUrl = callbackUrlInput?.value?.trim() || null;
    let customData: string | null = null;

    const reward = rewardInput?.value || "";
    const quotaTotal = Number(taskLimitInput?.value || "0");
    const unitPriceAtomic = usdcToAtomic(reward);
    const durationDays = Number(durationDaysInput?.value || "0");

    if (!name || !category || !title || !description || !detailUrl || !unitPriceAtomic || quotaTotal <= 0) {
        showNotification("Please complete required fields.", "error");
        return;
    }

    const validCategories = ["follow", "visit", "register", "share"];
    if (!validCategories.includes(category)) {
        showNotification("Invalid category selected.", "error");
        return;
    }

    // Validate and parse custom_data JSON if provided
    const customDataRaw = customDataInput?.value?.trim() || "";
    if (customDataRaw) {
        try {
            const parsed = JSON.parse(customDataRaw);
            customData = JSON.stringify(parsed);
        } catch {
            showNotification("Invalid custom data JSON format.", "error");
            return;
        }
    }

    const payload = {
        a_x_id: currentXId,
        category,
        name,
        title,
        description,
        detail_url: detailUrl,
        image_url: imageUrl,
        callback_url: callbackUrl,
        custom_data: customData,
        unit_price_atomic: unitPriceAtomic,
        quota_total: quotaTotal,
        duration_days: durationDays,
    };

    const result = await x402WorkerFetch("/ads/create", payload);
    if (!result.ok) {
        if (result.error?.error === "INSUFFICIENT_BALANCE") {
            showNotification(`Insufficient balance. ${result.error?.detail || ""}`.trim(), "error");
            return;
        }
        showNotification("Failed to create ad.", "error");
        return;
    }

    showNotification("Ad created successfully", "success");
    closeWizard();
    await refreshAdsData();
}

export function initWizardEvents() {
    const btnPublish = $Id("btn-publish-ad") as HTMLButtonElement | null;
    if (btnPublish) btnPublish.addEventListener("click", () => void handlePublishClick());

    const closeWizardBtn = $Id("close-wizard") as HTMLButtonElement | null;
    if (closeWizardBtn) closeWizardBtn.addEventListener("click", closeWizard);

    const btnPrev = $Id("btn-wizard-prev") as HTMLButtonElement | null;
    if (btnPrev) btnPrev.addEventListener("click", goWizardPrev);

    const btnNext = $Id("btn-wizard-next") as HTMLButtonElement | null;
    if (btnNext) btnNext.addEventListener("click", goWizardNext);

    const btnSubmit = $Id("btn-wizard-submit") as HTMLButtonElement | null;
    if (btnSubmit) btnSubmit.addEventListener("click", submitWizard);

    const rewardAmount = document.querySelector<HTMLInputElement>("#reward-amount");
    if (rewardAmount) rewardAmount.addEventListener("input", updateBudgetSummaryAndBalance);

    const taskLimit = document.querySelector<HTMLInputElement>("#task-limit");
    if (taskLimit) taskLimit.addEventListener("input", updateBudgetSummaryAndBalance);

    const adCategoryInput = document.querySelector<HTMLSelectElement>("#ad-category");
    const adUrlInput = document.querySelector<HTMLInputElement>("#ad-url");
    if (adCategoryInput && adUrlInput) {
        adCategoryInput.addEventListener("change", () => {
            const category = adCategoryInput.value.trim();
            if (category === "follow") {
                const xName = getCurrentXUserName();
                if (xName) {
                    adUrlInput.value = `https://x.com/${xName}`;
                    adUrlInput.style.backgroundColor = "#f5f5f5";
                }
            } else {
                adUrlInput.style.backgroundColor = "";
            }
        });
    }
}


