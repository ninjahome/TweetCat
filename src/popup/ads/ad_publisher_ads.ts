import {
    createAd,
    fetchAdsBalance,
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
        const balance = await fetchAdsBalance(xId);

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
    const adUrlInput = document.querySelector<HTMLInputElement>("#ad-url");
    const rewardInput = document.querySelector<HTMLInputElement>("#reward-amount");
    const taskLimitInput = document.querySelector<HTMLInputElement>("#task-limit");
    const startAtInput = document.querySelector<HTMLInputElement>("#start-time");
    const endAtInput = document.querySelector<HTMLInputElement>("#end-time");
    const rulesJsonInput = document.querySelector<HTMLTextAreaElement>("#rules-json");

    const name = nameInput?.value?.trim() || "";
    const category = adCategoryInput?.value?.trim() || "";
    const title = adTitleInput?.value?.trim() || "";
    const description = adDescriptionInput?.value?.trim() || "";
    const detailUrl = adUrlInput?.value?.trim() || "";
    let rulesJson: string | null = null;

    const reward = rewardInput?.value || "";
    const quotaTotal = Number(taskLimitInput?.value || "0");
    const unitPriceAtomic = usdcToAtomic(reward);

    if (!name || !category || !title || !description || !detailUrl || !unitPriceAtomic || quotaTotal <= 0) {
        showNotification("Please complete required fields.", "error");
        return;
    }

    const validCategories = ["follow", "visit", "register", "share"];
    if (!validCategories.includes(category)) {
        showNotification("Invalid category selected.", "error");
        return;
    }

    const rulesRaw = rulesJsonInput?.value?.trim() || "";
    if (rulesRaw) {
        try {
            const parsed = JSON.parse(rulesRaw);
            rulesJson = JSON.stringify(parsed);
        } catch {
            showNotification("Invalid rules JSON format.", "error");
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
        unit_price_atomic: unitPriceAtomic,
        quota_total: quotaTotal,
        start_at: startAtInput?.value || null,
        end_at: endAtInput?.value || null,
        ...(rulesJson ? {rules_json: rulesJson} : {}),
    };

    const result = await createAd(payload);
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
}


