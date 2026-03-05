import { showNotification } from "../common";
import { initWalletInfo } from "./ad_publisher_common";
import {
    initHistoryModalEvents,
    initNavEvents,
    initSpendTabs,
    initPaginationEvents,
    initSpendPaginationEvents,
    refreshAdsData,
    fetchDashboardInfo,
    fetchSpendHistory
} from "./ad_publisher_dashboard";
import { initWizardEvents } from "./ad_publisher_ads";
import { initRechargeModalEvents } from "./ad_publisher_balance";
import { t } from "../../common/i18n";
import { $Id } from "../common";

export function translateAdvertiseUI() {
    // 1. Header
    const titleText = document.querySelector(".plaza-header .logo-text");
    if (titleText) titleText.textContent = t("header_advertise_title");
    const subText = document.querySelector(".plaza-header .logo-sub");
    if (subText) subText.textContent = t("header_advertise_sub");

    const balanceLabel = $Id("balance-label");
    if (balanceLabel) balanceLabel.textContent = t("balance_label");

    // 2. Main Sidebar & Back Button
    const btnBack = document.querySelector("#btn-back-plaza span");
    if (btnBack) btnBack.textContent = t("btn_plaza");

    const sectionTitle = document.querySelector(".my-ads-section .section-title");
    if (sectionTitle) sectionTitle.textContent = t("section_my_ads");
    const sectionSub = document.querySelector(".my-ads-section .section-subtitle");
    if (sectionSub) sectionSub.textContent = t("section_my_ads_sub");

    const publishText = document.querySelector(".btn-publish-ad .publish-text");
    if (publishText) publishText.textContent = t("btn_publish_new_ad");

    // 3. Table Headers (My Ads)
    const adsThs = document.querySelectorAll(".ads-table thead th");
    if (adsThs.length >= 9) {
        adsThs[0].textContent = t("th_ad_name");
        adsThs[1].textContent = t("th_status");
        adsThs[2].textContent = t("th_reward_per_task");
        adsThs[3].textContent = t("th_claimed");
        adsThs[4].textContent = t("th_settled");
        adsThs[5].textContent = t("th_spent");
        adsThs[6].textContent = t("th_remaining_budget");
        adsThs[7].textContent = t("th_end_date");
        adsThs[8].textContent = t("th_actions");
    }

    // 4. Empty State
    const emptyAds = document.querySelector("#my-ads-tbody .empty-state-small p");
    if (emptyAds) emptyAds.textContent = t("msg_no_ads_published");

    // 5. Pagination
    const prevBtn = $Id("btn-prev-page");
    if (prevBtn) prevBtn.textContent = "< " + t("btn_previous");
    const nextBtn = $Id("btn-next-page");
    if (nextBtn) nextBtn.textContent = t("btn_next") + " >";

    // 6. Recent Activity
    const recentTitle = document.querySelector(".spending-section .section-title");
    if (recentTitle) recentTitle.textContent = t("section_recent_activity");
    const recentSub = document.querySelector(".spending-section .section-subtitle");
    if (recentSub) recentSub.textContent = t("section_recent_activity_sub");

    const spendThs = document.querySelectorAll(".spending-table thead th");
    if (spendThs.length >= 6) {
        spendThs[0].textContent = t("th_time");
        spendThs[1].textContent = t("th_ad");
        spendThs[2].textContent = t("th_event");
        spendThs[3].textContent = t("th_amount");
        spendThs[4].textContent = t("th_service_fee");
        spendThs[5].textContent = t("th_status");
    }
    const emptySpend = document.querySelector("#spending-tbody .empty-state-small p");
    if (emptySpend) emptySpend.textContent = t("msg_no_spending_records");

    // 7. Aside / Dashboard
    const sideTitle = document.querySelector(".side-sticky .side-title");
    if (sideTitle) sideTitle.textContent = t("side_wallet_insights");

    const availLabel = document.querySelector(".dashboard-card-wallet .card-label");
    if (availLabel) availLabel.textContent = t("label_available");
    const frozenLabel = document.querySelector(".wallet-balance-line:nth-child(2) .card-label");
    if (frozenLabel) frozenLabel.textContent = t("label_frozen");
    const frozenMeta = document.querySelector(".dashboard-card-wallet .card-meta");
    if (frozenMeta) frozenMeta.textContent = t("meta_frozen_funds");
    const btnRecharge = $Id("btn-recharge");
    if (btnRecharge) btnRecharge.textContent = "⇄ " + t("btn_transfer");

    const activeAdLabel = document.querySelector(".dashboard-card-active .card-label");
    if (activeAdLabel) activeAdLabel.textContent = t("label_active_campaigns");
    const activeAdMeta = document.querySelector(".dashboard-card-active .card-meta");
    if (activeAdMeta) activeAdMeta.textContent = t("meta_running_deliverable");

    const spendGroupTitle = document.querySelector(".spend-group .dashboard-group-title");
    if (spendGroupTitle) spendGroupTitle.textContent = t("label_spend");
    const spendTabs = document.querySelectorAll(".spend-group .dashboard-tab");
    if (spendTabs.length >= 2) {
        spendTabs[0].textContent = t("tab_today");
        spendTabs[1].textContent = t("tab_7d");
    }
    const todaySpendLabel = document.querySelector(".dashboard-card-spend[data-range='today'] .card-label");
    if (todaySpendLabel) todaySpendLabel.textContent = t("label_today_spend");
    const weekSpendLabel = document.querySelector(".dashboard-card-spend[data-range='week'] .card-label");
    if (weekSpendLabel) weekSpendLabel.textContent = t("label_week_spend");

    const sideNote = document.querySelector(".side-note");
    if (sideNote) sideNote.textContent = t("side_tips");

    // 8. Publish Wizard Modal
    const wizardTitle = document.querySelector("#publish-wizard-modal .modal-title");
    if (wizardTitle) wizardTitle.textContent = t("modal_publish_follow_title");
    const wizardIntro = document.querySelector("#publish-wizard-modal .form-intro");
    if (wizardIntro) wizardIntro.textContent = t("form_intro_follow");

    const labelName = document.querySelector("label[for='ad-name']");
    if (labelName) labelName.textContent = t("label_campaign_name");
    const inputName = $Id("ad-name") as HTMLInputElement;
    if (inputName) inputName.placeholder = t("placeholder_campaign_name");
    const hintName = document.querySelector(".form-group:nth-child(2) .form-hint");
    if (hintName) hintName.textContent = t("hint_campaign_name");

    const labelReward = document.querySelector("label[for='reward-amount']");
    if (labelReward) labelReward.textContent = t("label_reward_per_follow");
    const labelQuota = document.querySelector("label[for='task-limit']");
    if (labelQuota) labelQuota.textContent = t("label_max_followers");
    const hintQuota = $Id("quota-hint");
    if (hintQuota) hintQuota.textContent = t("hint_quota");

    const labelTarget = document.querySelector("label[for='target-url']");
    if (labelTarget) labelTarget.textContent = t("label_target_profile_url");
    const hintTarget = document.querySelector(".form-group:nth-child(4) .form-hint");
    if (hintTarget) hintTarget.textContent = t("hint_target_profile_url");

    const labelEndDate = document.querySelector("label[for='end-date']");
    if (labelEndDate) labelEndDate.textContent = t("label_campaign_end_date");
    const hintEndDate = document.querySelector(".form-group:nth-child(5) .form-hint");
    if (hintEndDate) hintEndDate.textContent = t("hint_end_date");

    const summaryLabels = document.querySelectorAll(".budget-summary .summary-label");
    if (summaryLabels.length >= 3) {
        summaryLabels[0].textContent = t("label_reward_per_follow");
        summaryLabels[1].textContent = t("label_max_followers");
        summaryLabels[2].textContent = t("label_total_budget");
    }
    const balLabel = document.querySelector(".balance-check-row span:nth-child(1)");
    if (balLabel) balLabel.textContent = t("label_your_balance");
    const noteBlue = document.querySelector(".eligibility-note .note-text");
    if (noteBlue) noteBlue.textContent = t("note_blue_verified_only");

    const btnPublishSub = $Id("btn-wizard-submit");
    if (btnPublishSub) btnPublishSub.textContent = t("btn_pay_publish");

    // 9. Recharge Modal
    const rechargeTitle = document.querySelector("#recharge-modal .modal-title");
    if (rechargeTitle) rechargeTitle.textContent = t("modal_recharge_title");
    const rechargeSub = document.querySelector(".recharge-content h3");
    if (rechargeSub) rechargeSub.textContent = t("recharge_transfer_title");
    const dirLabel = document.querySelector(".recharge-method h4");
    if (dirLabel) dirLabel.textContent = t("label_direction");

    const btnW2A = $Id("transfer-dir-wallet-to-ads");
    if (btnW2A) btnW2A.textContent = t("btn_wallet_to_ads");
    const btnA2W = $Id("transfer-dir-ads-to-wallet");
    if (btnA2W) btnA2W.textContent = t("btn_ads_to_wallet");

    const transLabels = document.querySelectorAll(".transfer-summary-label");
    if (transLabels.length >= 3) {
        transLabels[0].textContent = t("label_wallet_usdc");
        transLabels[1].textContent = t("label_ads_available");
        transLabels[2].textContent = t("label_ads_frozen");
    }

    const withdrawWarn = document.querySelector("#monthly-limit-warning .warning-text");
    if (withdrawWarn) withdrawWarn.textContent = t("warning_monthly_limit");

    const amountLabelHead = document.querySelectorAll(".recharge-method h4")[1];
    if (amountLabelHead) amountLabelHead.textContent = t("label_amount");
    const amountHint = document.querySelector(".recharge-method p");
    if (amountHint) amountHint.textContent = t("hint_transfer_amount");
    const btnMax = $Id("transfer-max");
    if (btnMax) btnMax.textContent = t("btn_max");
    const frozenHint = $Id("transfer-hint");
    if (frozenHint) frozenHint.textContent = t("hint_frozen_no_transfer");

    const limitTitle = document.querySelector(".limit-details-header span:nth-child(2)");
    if (limitTitle) limitTitle.textContent = t("modal_limit_reached_title");
    const limitMsg = $Id("limit-message");
    if (limitMsg) limitMsg.textContent = t("limit_reached_msg");

    const limitLabels = document.querySelectorAll(".limit-details-row .detail-label");
    if (limitLabels.length >= 2) {
        limitLabels[0].textContent = t("label_prev_withdrawal");
        limitLabels[1].textContent = t("label_next_available");
    }
    const btnPrevTx = document.querySelector("#btn-view-previous-tx span:nth-child(2)");
    if (btnPrevTx) btnPrevTx.textContent = t("btn_view_prev_tx");
    const btnTransSub = $Id("btn-transfer-submit");
    if (btnTransSub) btnTransSub.textContent = t("btn_transfer_submit");
    const btnHistory = $Id("btn-history");
    if (btnHistory) btnHistory.textContent = "📋 " + t("btn_view_history");

    // 10. History Modal
    const historyTitle = document.querySelector("#history-modal .modal-title");
    if (historyTitle) historyTitle.textContent = t("modal_history_title");
    const historyThs = document.querySelectorAll(".history-table thead th");
    if (historyThs.length >= 5) {
        historyThs[0].textContent = t("th_time");
        historyThs[1].textContent = t("th_direction");
        historyThs[2].textContent = t("th_amount");
        historyThs[3].textContent = t("th_status");
        historyThs[4].textContent = t("th_transaction");
    }
    const emptyHistory = document.querySelector("#recharge-history-tbody .empty-row td");
    if (emptyHistory) emptyHistory.textContent = t("msg_no_recharge_records");

    // 11. Add Budget Modal
    const addBudgetTitle = document.querySelector("#top-up-budget-modal .modal-title");
    if (addBudgetTitle) addBudgetTitle.textContent = t("modal_add_budget_title");
    const availBalLabel = document.querySelector("#top-up-budget-modal .form-group label");
    if (availBalLabel) availBalLabel.textContent = t("label_curr_available");
    const btnCancelTop = $Id("btn-cancel-top-up");
    if (btnCancelTop) btnCancelTop.textContent = t("btn_cancel");
    const btnConfirmTop = $Id("btn-confirm-top-up");
    if (btnConfirmTop) btnConfirmTop.textContent = t("btn_confirm");

    // 12. Detail Modal
    const detailTitle = document.querySelector("#ad-detail-modal .modal-title");
    if (detailTitle) detailTitle.textContent = t("modal_campaign_details_title");
    const overviewLabel = document.querySelector(".ad-detail-content .detail-section h3");
    if (overviewLabel) overviewLabel.textContent = t("label_overview");

    const detailLabels = document.querySelectorAll(".detail-item .detail-label");
    if (detailLabels.length >= 6) {
        detailLabels[0].textContent = t("th_ad_name");
        detailLabels[1].textContent = t("th_status");
        detailLabels[2].textContent = t("label_reward_per_follow");
        detailLabels[3].textContent = t("label_max_followers");
        detailLabels[4].textContent = t("th_end_date");
        detailLabels[5].textContent = t("label_created_at");
    }

    const devLabel = document.querySelector("#toggle-developer-settings span:nth-child(1)");
    if (devLabel) devLabel.textContent = t("label_dev_settings");
    const callbackLabel = document.querySelector("label[for='detail-callback-url']");
    if (callbackLabel) callbackLabel.textContent = t("label_callback_url");
    const customDataLabel = document.querySelector("label[for='detail-custom-data']");
    if (customDataLabel) customDataLabel.textContent = t("label_custom_data");
    const btnUpdateSet = $Id("btn-update-ad-settings");
    if (btnUpdateSet) btnUpdateSet.textContent = t("btn_update_settings");

    const loadingMsg = document.querySelector(".loading-message");
    if (loadingMsg) loadingMsg.textContent = t("processing_label");

    const btnPopCancel = $Id("btn-cancel");
    if (btnPopCancel) btnPopCancel.textContent = t("btn_cancel");
    const btnPopOk = $Id("btn-ok");
    if (btnPopOk) btnPopOk.textContent = t("btn_confirm");

    const alertTitle = $Id("alert-title");
    if (alertTitle) alertTitle.textContent = t("alert_title");
    const alertOk = $Id("alert-ok");
    if (alertOk) alertOk.textContent = t("btn_ok");
}

async function initAdvertise() {
    translateAdvertiseUI();
    initNavEvents();
    initSpendTabs();
    initWizardEvents();
    initRechargeModalEvents();
    initHistoryModalEvents();
    initPaginationEvents();
    initSpendPaginationEvents();

    // 钱包 + 数据
    try {
        await initWalletInfo();
        await fetchDashboardInfo();
        await refreshAdsData();
        await fetchSpendHistory();
    } catch (err: any) {
        console.error("Failed to initialize wallet info:", err);
        showNotification(err?.message || t("please_sign_in_first"), "error");
    }
}

document.addEventListener("DOMContentLoaded", () => {
    initAdvertise().catch((err) => console.error("Advertise init error:", err));
});