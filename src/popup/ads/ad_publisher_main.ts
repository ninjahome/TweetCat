import {showNotification} from "../common";
import {initWalletInfo, publisherState} from "./ad_publisher_common";
import {
    initHistoryModalEvents,
    initNavEvents,
    initSpendTabs,
    refreshAdsData,
    renderMyAdsTable,
    renderSpendTable,
    fetchDashboardInfo
} from "./ad_publisher_dashboard";
import {initWizardEvents} from "./ad_publisher_ads";
import {logAdP} from "../../common/debug_flags";
import {initRechargeModalEvents} from "./ad_publisher_balance";

async function initAdvertise() {
    // 初始空态渲染 - 不再需要，因为将由新的dashboard API处理
    // renderHeaderBalance();
    // renderAdvertiseDashboard();
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
        
        // 调用新的dashboard info API并将结果输出到日志，同时更新UI
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