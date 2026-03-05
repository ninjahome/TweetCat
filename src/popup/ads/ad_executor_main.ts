import {
    initPlazaFiltersEvents,
    loadAds,
    renderEarnAds,
    updateFilterToolsUI,
    updateBlueVDisplay
} from "./ad_executor_plaza";
import {
    initSummaryActions,
    loadEarnSummary
} from "./ad_executor_summary";
import { loadTaskRunState } from "./ad_executor_common";

import { t } from "../../common/i18n";

async function translatePlazaUI() {
    // Page Title
    document.title = t("plaza_title");

    // Header
    const logoText = document.querySelector(".plaza-header .logo-text");
    if (logoText) logoText.textContent = t("plaza_header_logo");

    const btnPublish = document.getElementById("btn-open-advertise");
    if (btnPublish) btnPublish.textContent = t("btn_publish_ad");

    // Sidebar/Withdraw Card
    const updatedToday = document.querySelector(".withdraw-status");
    if (updatedToday) updatedToday.textContent = t("withdraw_updated_today");

    const withdrawableLabel = document.querySelector(".withdraw-card .card-label");
    if (withdrawableLabel) withdrawableLabel.textContent = t("withdrawable_label");

    const btnWithdraw = document.getElementById("btn-withdraw");
    if (btnWithdraw) btnWithdraw.textContent = t("btn_withdraw");

    const btnActivity = document.getElementById("btn-earn-activity");
    if (btnActivity) btnActivity.textContent = t("btn_activity");

    const verificationLabel = document.querySelector(".user-verification-status span:first-child");
    if (verificationLabel) verificationLabel.textContent = t("verification_label");

    const blueVDisplay = document.getElementById("blue-v-display");
    if (blueVDisplay) blueVDisplay.textContent = t("loading");

    // Earn Summary
    const summaries = document.querySelectorAll(".earn-summary .summary-item");
    if (summaries[0]) {
        const labels = summaries[0].querySelector(".summary-label");
        if (labels) labels.innerHTML = `${t("summaries_total_earned")}<br>(USDC)`;
    }
    if (summaries[1]) {
        const labels = summaries[1].querySelector(".summary-label");
        if (labels) labels.innerHTML = `${t("summaries_today_earned")}<br>(USDC)`;
    }
    if (summaries[2]) {
        const labels = summaries[2].querySelector(".summary-label");
        if (labels) labels.innerHTML = `${t("summaries_pending")}<br>(USDC)`;
    }

    // Filters
    const filterTitle = document.querySelector(".filters-sidebar .filter-title");
    if (filterTitle) filterTitle.textContent = t("filters_title");

    const btnClearFilters = document.getElementById("btn-clear-filters");
    if (btnClearFilters) btnClearFilters.textContent = t("btn_clear_filters");

    const adSearch = document.getElementById("ad-search") as HTMLInputElement;
    if (adSearch) adSearch.placeholder = t("search_ads_placeholder");

    const filterGroupTitles = document.querySelectorAll(".filters-sidebar .filter-group-title");
    if (filterGroupTitles[0]) filterGroupTitles[0].textContent = t("reward_range_label");
    if (filterGroupTitles[1]) filterGroupTitles[1].textContent = t("sort_by_label");

    // Sort options
    const sortSelect = document.getElementById("sort-select") as HTMLSelectElement;
    if (sortSelect) {
        sortSelect.options[0].textContent = t("sort_reward_high");
        sortSelect.options[1].textContent = t("sort_newest");
        sortSelect.options[2].textContent = t("sort_time_short");
        sortSelect.options[3].textContent = t("sort_popular");
    }

    // Tabs
    const tabs = document.querySelectorAll(".plaza-tabs .plaza-tab");
    if (tabs[0]) tabs[0].textContent = t("tab_explore");
    if (tabs[1]) tabs[1].textContent = t("tab_my_tasks");

    // My Tasks Controls
    const taskStatusLabel = document.querySelector("#my-tasks-controls label");
    if (taskStatusLabel) taskStatusLabel.textContent = t("status_label");

    const taskStatusFilter = document.getElementById("task-status-filter") as HTMLSelectElement;
    if (taskStatusFilter) {
        taskStatusFilter.options[0].textContent = t("task_status_all_option");
        taskStatusFilter.options[1].textContent = t("status_pending_verification");
        taskStatusFilter.options[2].textContent = t("status_settled_paid");
        taskStatusFilter.options[3].textContent = t("status_rejected");
    }

    // Pagination
    const btnPrev = document.getElementById("btn-prev-page");
    if (btnPrev) btnPrev.textContent = t("btn_previous");

    const btnNext = document.getElementById("btn-next-page");
    if (btnNext) btnNext.textContent = t("btn_next");

    // Templates
    const tplAdCard = document.getElementById("tpl-ad-card") as HTMLTemplateElement;
    if (tplAdCard) {
        const rewardLabel = tplAdCard.content.querySelector(".reward-label");
        if (rewardLabel) rewardLabel.textContent = t("earn_label");
        const btnStart = tplAdCard.content.querySelector(".btn-start-task");
        if (btnStart) btnStart.textContent = t("btn_start_task");
    }

    // Modals
    const modalTitle = document.querySelector("#earn-activity-modal h3");
    if (modalTitle) modalTitle.textContent = t("activity_title");

    // Popups
    const alertTitle = document.getElementById("alert-title");
    if (alertTitle) alertTitle.textContent = t("alert_title");

    const btnAlertOk = document.getElementById("alert-ok");
    if (btnAlertOk) btnAlertOk.textContent = t("ok");

    const btnCancel = document.getElementById("btn-cancel");
    if (btnCancel) btnCancel.textContent = t("cancel");

    const btnConfirmOk = document.getElementById("btn-ok");
    if (btnConfirmOk) btnConfirmOk.textContent = t("confirm");

    const loadingMsg = document.querySelector("#loading-overlay .loading-message");
    if (loadingMsg) loadingMsg.textContent = t("processing");
}

async function initAdPlaza() {
    // 初始翻译
    await translatePlazaUI();

    // 并行获取初始数据
    await Promise.all([
        loadAds(),
        loadEarnSummary(),
        updateBlueVDisplay(),
        loadTaskRunState()
    ]);

    renderEarnAds();

    initPlazaFiltersEvents();
    initSummaryActions();
    updateFilterToolsUI();

    document.querySelector<HTMLButtonElement>("#btn-open-advertise")?.addEventListener("click", () => {
        window.location.href = "ad_advertise.html";
    });
}

document.addEventListener("DOMContentLoaded", () => {
    try {
        initAdPlaza().then();
    } catch (err) {
        console.error("Ad Plaza (Executor) init error:", err);
    }
});
