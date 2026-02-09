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

async function initAdPlaza() {
    // 并行获取初始数据
    await Promise.all([
        loadAds(),
        loadEarnSummary(),
        updateBlueVDisplay()
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
