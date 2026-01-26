import {
    getCurrentXUserName
} from "./ad_publisher_common";
import {getCurrentXId} from "./ad_publisher_common";
import {updateBudgetSummaryAndBalance} from "./ad_publisher_dashboard";
import {
    $Id,
    showNotification, usdcToAtomic, showLoading, hideLoading
} from "../common";
import {refreshAdsData} from "./ad_publisher_dashboard";
import {x402WorkerFetch} from "../../wallet/cdp_wallet";

// ========= 发布广告向导（Wizard） =========
let wizardCurrentStep = 1;
const wizardMaxStep = 4;

function resetWizardForm() {
    // Step 1
    (document.querySelector<HTMLInputElement>("#ad-name") as HTMLInputElement).value = "";
    (document.querySelector<HTMLSelectElement>("#ad-category") as HTMLSelectElement).value = "";

    // Step 2
    (document.querySelector<HTMLInputElement>("#ad-title") as HTMLInputElement).value = "";
    (document.querySelector<HTMLTextAreaElement>("#ad-description") as HTMLTextAreaElement).value = "";
    (document.querySelector<HTMLInputElement>("#ad-image") as HTMLInputElement).value = "";
    (document.querySelector<HTMLInputElement>("#ad-url") as HTMLInputElement).value = "";

    // Step 3
    (document.querySelector<HTMLInputElement>("#reward-amount") as HTMLInputElement).value = "";
    (document.querySelector<HTMLInputElement>("#task-limit") as HTMLInputElement).value = "";
    (document.querySelector<HTMLInputElement>("#end-date") as HTMLInputElement).value = "";
    (document.querySelector<HTMLInputElement>("#callback-url") as HTMLInputElement).value = "";
    (document.querySelector<HTMLTextAreaElement>("#custom-data") as HTMLTextAreaElement).value = "";

    // Reset any dynamic styles
    const adUrlInput = document.querySelector<HTMLInputElement>("#ad-url");
    if (adUrlInput) adUrlInput.style.backgroundColor = "";
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
    
    // Step 2 validation: ad-title, ad-description, ad-url must be filled
    if (wizardCurrentStep === 2) {
        const adTitleInput = document.querySelector<HTMLInputElement>("#ad-title");
        const adDescriptionInput = document.querySelector<HTMLTextAreaElement>("#ad-description");
        const adUrlInput = document.querySelector<HTMLInputElement>("#ad-url");

        const title = adTitleInput?.value?.trim() || "";
        const description = adDescriptionInput?.value?.trim() || "";
        const detailUrl = adUrlInput?.value?.trim() || "";

        if (!title) {
            showNotification("Ad Title is required.", "error");
            return;
        }
        if (!description) {
            showNotification("Description is required.", "error");
            return;
        }
        if (!detailUrl) {
            showNotification("Landing Page URL is required.", "error");
            return;
        }
    }

    // Step 3 validation: reward-amount, task-limit, and end-date
    if (wizardCurrentStep === 3) {
        const rewardInput = document.querySelector<HTMLInputElement>("#reward-amount");
        const taskLimitInput = document.querySelector<HTMLInputElement>("#task-limit");
        const endDateInput = document.querySelector<HTMLInputElement>("#end-date");

        const reward = Number(rewardInput?.value || "0");
        const taskLimit = Number(taskLimitInput?.value || "0");
        const endDate = endDateInput?.value || "";

        if (reward <= 0) {
            showNotification("Reward per Task must be greater than 0.", "error");
            return;
        }
        if (taskLimit <= 0) {
            showNotification("Total Task Limit must be greater than 0.", "error");
            return;
        }
        if (!endDate) {
            showNotification("Please select an end date for the campaign.", "error");
            return;
        }
        const endDateObj = new Date(endDate);
        if (isNaN(endDateObj.getTime()) || endDateObj <= new Date()) {
            showNotification("End date must be in the future.", "error");
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
// DEPRECATED: 此函数已被废弃，余额检查和仪表盘信息现在通过统一的fetchDashboardInfo API处理
// 旧的handlePublishClick函数实现已删除，参见ad_publisher_dashboard.ts中的fetchDashboardInfo函数


async function submitWizard() {
    const submitBtn = $Id("btn-wizard-submit") as HTMLButtonElement | null;
    if (submitBtn) submitBtn.disabled = true;
    showLoading("Publishing ad...");

    try {
        const currentXId = getCurrentXId();

        const nameInput = document.querySelector<HTMLInputElement>("#ad-name");
        const adCategoryInput = document.querySelector<HTMLSelectElement>("#ad-category");
        const adTitleInput = document.querySelector<HTMLInputElement>("#ad-title");
        const adDescriptionInput = document.querySelector<HTMLTextAreaElement>("#ad-description");
        const adImageInput = document.querySelector<HTMLInputElement>("#ad-image");
        const adUrlInput = document.querySelector<HTMLInputElement>("#ad-url");
        const rewardInput = document.querySelector<HTMLInputElement>("#reward-amount");
        const taskLimitInput = document.querySelector<HTMLInputElement>("#task-limit");
        const endDateInput = document.querySelector<HTMLInputElement>("#end-date");
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
        const endDate = endDateInput?.value || "";

        if (!name || !category || !title || !description || !detailUrl || !unitPriceAtomic || quotaTotal <= 0 || !endDate) {
            showNotification("Please complete all required fields.", "error");
            return;
        }

        // Validate end date
        const endDateObj = new Date(endDate);
        if (isNaN(endDateObj.getTime()) || endDateObj <= new Date()) {
            showNotification("End date must be in the future.", "error");
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
            end_date: endDateObj.toISOString(), // Send as ISO string
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
        resetWizardForm(); // Reset form after successful submission
    } catch (e: any) {
        showNotification(e?.message || "Failed to create ad.", "error");
    } finally {
        if (submitBtn) submitBtn.disabled = false;
        hideLoading();
    }
}

export function initWizardEvents() {
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
