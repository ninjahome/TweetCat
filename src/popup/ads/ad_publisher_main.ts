import {showNotification} from "../common";
import {initWalletInfo} from "./ad_publisher_common";
import {
    initHistoryModalEvents,
    initNavEvents,
    initSpendTabs,
    refreshAdsData,
    renderSpendTable,
    fetchDashboardInfo
} from "./ad_publisher_dashboard";
import {initWizardEvents} from "./ad_publisher_ads";
import {initRechargeModalEvents} from "./ad_publisher_balance";

async function initAdvertise() {
    renderSpendTable();
    initNavEvents();
    initSpendTabs();
    initWizardEvents();
    initRechargeModalEvents();
    initHistoryModalEvents();

    // 钱包 + 数据
    try {
        await initWalletInfo();
        await fetchDashboardInfo();
        await refreshAdsData();
    } catch (err: any) {
        console.error("Failed to initialize wallet info:", err);
        showNotification(err?.message || "Please sign in first.", "error");
    }
}

document.addEventListener("DOMContentLoaded", () => {
    initAdvertise().catch((err) => console.error("Advertise init error:", err));
});