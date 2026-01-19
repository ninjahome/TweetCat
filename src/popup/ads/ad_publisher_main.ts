import {showNotification} from "../common";
import {initWalletInfo, publisherState} from "./ad_publisher_common";
import {
    initHistoryModalEvents,
    initNavEvents,
    initSpendTabs,
    refreshAdsData,
    renderAdvertiseDashboard,
    renderHeaderBalance,
    renderMyAdsTable,
    renderSpendTable
} from "./ad_publisher_dashboard";
import {initWizardEvents} from "./ad_publisher_ads";
import {logAdP} from "../../common/debug_flags";
import {initRechargeModalEvents} from "./ad_publisher_balance";

async function initAdvertise() {
    // 初始空态渲染
    renderHeaderBalance();
    renderAdvertiseDashboard();
    renderMyAdsTable();
    renderSpendTable();

    // 绑定事件
    initNavEvents();
    initSpendTabs();
    initWizardEvents();
    initRechargeModalEvents();
    initHistoryModalEvents();

    // 钱包 + 数据
    try {
        await initWalletInfo();
        logAdP("------>>> wallet info:", publisherState.walletInfoCache);
        await refreshAdsData();
    } catch (err: any) {
        console.error("Failed to initialize wallet info:", err);
        showNotification(err?.message || "Please sign in first.", "error");
    }
}

document.addEventListener("DOMContentLoaded", () => {
    initAdvertise().catch((err) => console.error("Advertise init error:", err));
});
