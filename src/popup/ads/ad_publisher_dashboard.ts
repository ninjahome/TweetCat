import {
    $2,
    $Id,
    atomicToUsdcNumber,
    cloneTemplate,
    formatUSDC,
    formatUSDCTrimmed,
    hideLoading,
    multiplyAtomic,
    showLoading,
    showNotification,
    showConfirm,
    usdcToAtomic,
    formatTimeLocal
} from "../common";
import { t } from "../../common/i18n";
import { logAdP } from "../../common/debug_flags";
import type { AdRecord, AdStatus, ClaimantRecord, HistoryRow } from "./ad_publisher_common";
import {
    API_PATH_ADS_PUBLISHER_AD_CLAIMS,
    API_PATH_ADS_MY_ADS,
    API_PATH_ADS_PUBLISHER_DASHBOARD_INFO,
    API_PATH_ADS_PUBLISHER_SPEND_HISTORY,
    API_PATH_ADS_TOGGLE_STATUS,
    API_PATH_ADS_TOP_UP_BUDGET,
    API_PATH_ADS_UPDATE,
    adsWorkerFetch,
    adsWorkerGet,
    fetchAdEscrowLedger,
    getCurrentXId,
    openTxInExplorer,
    publisherState
} from "./ad_publisher_common";

// 状态显示名称映射
const AD_STATUS_LABELS: Record<string, string> = {
    'ACTIVE': t("status_active"),
    'PAUSED_MANUAL': t("status_paused"),
    'PAUSED_NO_BUDGET': t("status_paused_no_budget"),
    'EXPIRED': t("status_ended"),
    'COMPLETED': t("status_ended")
};

const CLAIMANT_STATUS_LABELS: Record<string, string> = {
    PENDING_CONFIRM: "Pending",
    CLAIMED: "Claimed",
    CONFIRMED: "Confirmed",
    REJECTED: "Rejected",
};

const claimantsModalState = {
    ad: null as AdRecord | null,
    currentPage: 1,
    pageSize: 10,
    totalCount: 0,
};

function getClaimantsPaginationMarkup(): string {
    return `
        <div id="claimants-pagination" class="claimants-pagination" style="display: none;">
            <button type="button" id="claimants-prev-page" class="claimants-page-btn">Previous</button>
            <span id="claimants-page-info" class="claimants-page-info">Page 1 / 1</span>
            <button type="button" id="claimants-next-page" class="claimants-page-btn">Next</button>
        </div>
    `;
}

function ensureClaimantsModal(): HTMLElement | null {
    let modal = $Id("claimants-modal");
    if (modal) {
        const content = modal.querySelector<HTMLElement>(".claimants-modal-content");
        const mockToolbar = content?.querySelector("#claimants-mock-toolbar");
        if (mockToolbar) mockToolbar.remove();
        if (content && !content.querySelector("#claimants-pagination")) {
            content.insertAdjacentHTML("beforeend", getClaimantsPaginationMarkup());
        }
        return modal;
    }

    modal = document.createElement("div");
    modal.id = "claimants-modal";
    modal.className = "modal";
    modal.innerHTML = `
        <div class="modal-dialog modal-large">
            <div class="modal-header">
                <h2 id="claimants-title" class="modal-title">Claimants List</h2>
                <button id="close-claimants" class="btn-close">✕</button>
            </div>
            <div class="modal-body">
                <div class="claimants-modal-content">
                    <div id="claimants-list" class="claimants-list">
                        <div class="claimants-empty">No claimants yet</div>
                    </div>
                    ${getClaimantsPaginationMarkup()}
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    return modal;
}

function renderClaimantsPagination() {
    const pager = $Id("claimants-pagination");
    const pageInfo = $Id("claimants-page-info");
    const prevBtn = $Id("claimants-prev-page") as HTMLButtonElement | null;
    const nextBtn = $Id("claimants-next-page") as HTMLButtonElement | null;
    if (!pager || !pageInfo || !prevBtn || !nextBtn) return;

    const totalPages = Math.max(1, Math.ceil(claimantsModalState.totalCount / claimantsModalState.pageSize));
    pager.style.display = claimantsModalState.totalCount > 0 ? "flex" : "none";

    if (claimantsModalState.currentPage > totalPages) {
        claimantsModalState.currentPage = totalPages;
    }

    pageInfo.textContent = `Page ${claimantsModalState.currentPage} / ${totalPages}`;
    prevBtn.disabled = claimantsModalState.currentPage <= 1;
    nextBtn.disabled = claimantsModalState.currentPage >= totalPages;
}

function bindClaimantsPaginationEvents() {
    const prevBtn = $Id("claimants-prev-page") as HTMLButtonElement | null;
    const nextBtn = $Id("claimants-next-page") as HTMLButtonElement | null;

    if (prevBtn) {
        prevBtn.onclick = () => {
            if (!claimantsModalState.ad || claimantsModalState.currentPage <= 1) return;
            void loadClaimantsPage(claimantsModalState.ad, claimantsModalState.currentPage - 1);
        };
    }

    if (nextBtn) {
        nextBtn.onclick = () => {
            if (!claimantsModalState.ad) return;
            const totalPages = Math.max(1, Math.ceil(claimantsModalState.totalCount / claimantsModalState.pageSize));
            if (claimantsModalState.currentPage >= totalPages) return;
            void loadClaimantsPage(claimantsModalState.ad, claimantsModalState.currentPage + 1);
        };
    }
}

// ========= 数据刷新 =========
export async function refreshAdsData(page: number = 1) {
    if (publisherState.ads.isLoading || !publisherState.walletInfoCache?.xId) return;

    const currentXId = getCurrentXId();
    const { pageSize } = publisherState.ads;
    const offset = (page - 1) * pageSize;

    publisherState.ads.isLoading = true;

    try {
        const response = await adsWorkerGet(API_PATH_ADS_MY_ADS, {
            a_x_id: currentXId,
            limit: pageSize.toString(),
            offset: offset.toString()
        });

        publisherState.ads.list = response.ads || [];
        publisherState.ads.totalCount = response.total || 0;
        publisherState.ads.currentPage = page;

        logAdP("------>>> my ads:", publisherState.ads.list, "Total:", publisherState.ads.totalCount);
        renderMyAdsTable();
        renderPaginationUI(); // 触发分页控件渲染
    } catch (error) {
        console.error("Failed to refresh ads data:", error);
    } finally {
        publisherState.ads.isLoading = false;
    }
}

// 新增函数：获取dashboard信息
// 加载仪表盘数据并更新状态
export async function fetchDashboardInfo() {
    if (!publisherState.walletInfoCache?.xId) return;
    const currentXId = getCurrentXId();

    try {
        const dashboardInfo = await adsWorkerGet(API_PATH_ADS_PUBLISHER_DASHBOARD_INFO, { a_x_id: currentXId });
        console.log("Dashboard info:", dashboardInfo);
        logAdP("Dashboard info:", dashboardInfo);

        // 更新 publisherState.dashboardInfo 以供其他组件使用
        publisherState.dashboardInfo = {
            balance_atomic: dashboardInfo.balance_atomic,
            frozen_atomic: dashboardInfo.frozen_atomic,
            active_campaigns_count: dashboardInfo.active_campaigns_count,
            today_spend_atomic: dashboardInfo.today_spend_atomic,
            week_spend_atomic: dashboardInfo.week_spend_atomic,
            last_withdraw_at: dashboardInfo.last_withdraw_at
        };

        updateDashboardUI()

        // 同时获取消费历史记录
        await fetchSpendHistory();
    } catch (error) {
        console.error("Failed to fetch dashboard info:", error);
        logAdP("Failed to fetch dashboard info:", error);
    }
}

/**
 * 获取广告消费记录并更新状态
 */
export async function fetchSpendHistory(page: number = 1) {
    if (publisherState.spend.isLoading || !publisherState.walletInfoCache?.xId) return;

    const currentXId = getCurrentXId();
    const { pageSize } = publisherState.spend;
    const offset = (page - 1) * pageSize;

    publisherState.spend.isLoading = true;

    try {
        // 获取消费历史记录
        const response = await adsWorkerGet(API_PATH_ADS_PUBLISHER_SPEND_HISTORY, {
            a_x_id: currentXId,
            limit: pageSize.toString(),
            offset: offset.toString()
        });

        if (response && response.success) {
            publisherState.spend.list = response.records || [];
            publisherState.spend.currentPage = page;
            publisherState.spend.totalCount = response.total || 0;
            renderSpendTable(); // 更新消费表格
            renderSpendPaginationUI();
        }
    } catch (error) {
        console.error("Failed to fetch spend history:", error);
        logAdP("Failed to fetch spend history:", error);
    } finally {
        publisherState.spend.isLoading = false;
    }
}

// 使用仪表盘数据更新UI元素
export function updateDashboardUI() {
    const dashboardInfo = publisherState.dashboardInfo;

    // 使用新的dashboard API结果更新UI元素
    const availableEl = $Id("ad-account-balance-value");
    if (availableEl) availableEl.textContent = formatUSDC(atomicToUsdcNumber(dashboardInfo.balance_atomic));

    const frozenEl = $Id("ad-account-frozen-value");
    if (frozenEl) frozenEl.textContent = formatUSDC(atomicToUsdcNumber(dashboardInfo.frozen_atomic));

    // 更新活跃广告数量
    const activeCards = document.querySelectorAll<HTMLElement>("#view-advertise .dashboard-card-active .card-value");
    if (activeCards.length > 0) {
        activeCards[0].textContent = dashboardInfo.active_campaigns_count.toString();
    }

    // 更新今日花费
    const todayCards = document.querySelectorAll<HTMLElement>("#view-advertise .dashboard-card-spend[data-range='today'] .card-value");
    if (todayCards.length > 0) {
        todayCards[0].textContent = formatUSDC(atomicToUsdcNumber(dashboardInfo.today_spend_atomic));
    }

    // 更新本周花费
    const weekCards = document.querySelectorAll<HTMLElement>("#view-advertise .dashboard-card-spend[data-range='week'] .card-value");
    if (weekCards.length > 0) {
        weekCards[0].textContent = formatUSDC(atomicToUsdcNumber(dashboardInfo.week_spend_atomic));
    }
}

// ========= 顶部余额 & Advertise 仪表盘 =========
// DEPRECATED: 以下函数已被弃用，不再使用
// 旧的 renderHeaderBalance 函数已被删除，现在由新的dashboard API统一处理
// 旧的 renderAdvertiseDashboard 函数已被删除，现在由新的dashboard API统一处理


interface MyAdRow {
    id: string;
    name: string;
    status: AdStatus;
    rewardPerTask: number;
    claimed: number;   // 已领取（占位）
    settled: number;   // 已结算（目前通常为 0，后续验证/结算后增长）
    spent: number;     // 已结算支出（与 settled 对应）
    remainingBudget: number; // 剩余可领取预算（按 quota_total - claimed 估算）
    totalQuota: number;
    endDate: string;
}

function buildMyAdRow(ad: AdRecord): MyAdRow {
    const rewardPerTask = atomicToUsdcNumber(ad.unit_price_atomic);
    const claimed = Number.isFinite(ad.quota_claimed as any) ? Number(ad.quota_claimed) : (Number.isFinite(ad.quota_used) ? ad.quota_used : 0);
    const settled = Number.isFinite(ad.quota_used) ? ad.quota_used : 0;
    const quotaTotal = Number.isFinite(ad.quota_total) ? ad.quota_total : 0;

    // 支出只按“已结算/已确认”口径计算；claimed 只是占位，不代表已发放
    const spentAtomic = multiplyAtomic(ad.unit_price_atomic, settled);
    const remainingAtomic = multiplyAtomic(ad.unit_price_atomic, Math.max(quotaTotal - claimed, 0));

    return {
        id: ad.ad_id,
        name: ad.name,
        status: ad.status,
        rewardPerTask,
        claimed,
        settled,
        spent: atomicToUsdcNumber(spentAtomic),
        remainingBudget: atomicToUsdcNumber(remainingAtomic),
        totalQuota: quotaTotal,
        endDate: ad.end_date,
    };
}

/**
 * 初始化分页组件事件
 */
export function initPaginationEvents() {
    const btnPrev = $Id("btn-prev-page") as HTMLButtonElement | null;
    const btnNext = $Id("btn-next-page") as HTMLButtonElement | null;

    if (btnPrev) {
        btnPrev.addEventListener("click", async () => {
            const { currentPage } = publisherState.ads;
            if (currentPage > 1) {
                await refreshAdsData(currentPage - 1);
            }
        });
    }

    if (btnNext) {
        btnNext.addEventListener("click", async () => {
            const { currentPage, totalCount, pageSize } = publisherState.ads;
            const maxPage = Math.ceil(totalCount / pageSize);
            if (currentPage < maxPage) {
                await refreshAdsData(currentPage + 1);
            }
        });
    }
}

/**
 * 渲染分页 UI 控件状态
 */
export function renderPaginationUI() {
    const { currentPage, totalCount, pageSize } = publisherState.ads;
    const maxPage = Math.ceil(totalCount / pageSize) || 1;

    const infoRange = $Id("pagination-current-range");
    const infoTotal = $Id("pagination-total-count");
    const pageInfo = $Id("pagination-page-info");
    const btnPrev = $Id("btn-prev-page") as HTMLButtonElement | null;
    const btnNext = $Id("btn-next-page") as HTMLButtonElement | null;

    const start = (currentPage - 1) * pageSize + 1;
    const end = Math.min(currentPage * pageSize, totalCount);

    if (infoRange) infoRange.textContent = totalCount > 0 ? `${start}-${end}` : "0";
    if (infoTotal) infoTotal.textContent = totalCount.toString();
    if (pageInfo) pageInfo.textContent = t("pagination_page_info_simple").replace("$1", currentPage.toString()).replace("$2", maxPage.toString());

    if (btnPrev) btnPrev.disabled = currentPage <= 1;
    if (btnNext) btnNext.disabled = currentPage >= maxPage;

    // 如果总数较少，隐藏分页面板（可选）
    const paginationEl = $Id("ads-pagination");
    if (paginationEl) {
        paginationEl.style.display = totalCount > 0 ? "flex" : "none";
    }
}

/**
 * 渲染消费记录分页 UI
 */
export function renderSpendPaginationUI() {
    const { currentPage, pageSize, totalCount } = publisherState.spend;
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

    const container = $Id('spend-pagination-container');
    const currPageEl = $Id('spend-current-page');
    const totalPagesEl = $Id('spend-total-pages');
    const totalCountEl = $Id('spend-total-count');
    const prevBtn = $Id('btn-spend-prev') as HTMLButtonElement | null;
    const nextBtn = $Id('btn-spend-next') as HTMLButtonElement | null;

    if (container) container.style.display = totalCount > 0 ? 'flex' : 'none';
    if (currPageEl) currPageEl.textContent = currentPage.toString();
    if (totalPagesEl) totalPagesEl.textContent = totalPages.toString();
    if (totalCountEl) totalCountEl.textContent = totalCount.toString();

    if (prevBtn) prevBtn.disabled = currentPage <= 1;
    if (nextBtn) nextBtn.disabled = currentPage >= totalPages;
}

/**
 * 初始化消费记录分页事件
 */
export function initSpendPaginationEvents() {
    const prevBtn = $Id('btn-spend-prev');
    const nextBtn = $Id('btn-spend-next');

    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            if (publisherState.spend.currentPage > 1) {
                fetchSpendHistory(publisherState.spend.currentPage - 1);
            }
        });
    }

    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            const { currentPage, pageSize, totalCount } = publisherState.spend;
            const totalPages = Math.ceil(totalCount / pageSize);
            if (currentPage < totalPages) {
                fetchSpendHistory(currentPage + 1);
            }
        });
    }
}


/**
 * 局部更新单行广告的 UI
 * @param ad - 最新的广告数据
 */
export function updateAdRowUI(ad: AdRecord) {
    const tr = document.querySelector<HTMLTableRowElement>(`#my-ads-tbody tr[data-ad-id="${ad.ad_id}"]`);
    if (tr) {
        syncAdRowData(tr, ad);
    }
}

/**
 * 渲染单行广告元素
 */
export function renderAdRow(ad: AdRecord): HTMLTableRowElement {
    const tr = cloneTemplate("tpl-my-ad-row") as HTMLTableRowElement;
    tr.dataset.adId = ad.ad_id;
    syncAdRowData(tr, ad);
    return tr;
}

/**
 * 将数据同步到现有的行元素中
 */
function syncAdRowData(tr: HTMLTableRowElement, ad: AdRecord) {
    const rowData = buildMyAdRow(ad);

    // 设置整行状态类名
    const statusClass = `ad-row--${ad.status.toLowerCase().replace(/_/g, '-')}`;
    tr.className = `my-ad-row ${statusClass}`;

    $2<HTMLElement>(tr, ".td-name").textContent = rowData.name;

    // 显示状态文本
    const statusEl = $2<HTMLElement>(tr, ".td-status");
    statusEl.textContent = AD_STATUS_LABELS[ad.status] || ad.status;

    $2<HTMLElement>(tr, ".td-reward").textContent = formatUSDCForPublish(rowData.rewardPerTask);
    // “Completed”列当前展示 claimed（占位/已领取），避免误把领取当成已结算消耗
    const claimedCell = $2<HTMLElement>(tr, ".td-completed");
    claimedCell.replaceChildren();
    if (rowData.claimed > 0) {
        const claimedBtn = document.createElement("button");
        claimedBtn.type = "button";
        claimedBtn.className = "claimed-count-btn";
        claimedBtn.textContent = rowData.claimed.toString();
        claimedBtn.title = "View claimants";
        claimedBtn.onclick = () => void openClaimantsModal(ad);
        claimedCell.appendChild(claimedBtn);
    } else {
        claimedCell.textContent = "0";
    }
    $2<HTMLElement>(tr, ".td-settled").textContent = rowData.settled.toString();
    $2<HTMLElement>(tr, ".td-spent").textContent = formatUSDC(rowData.spent);
    $2<HTMLElement>(tr, ".td-remaining").textContent = formatUSDC(rowData.remainingBudget);

    // 添加截止日期显示
    const endDateEl = $2<HTMLElement>(tr, ".td-end-date");
    const endDate = new Date(rowData.endDate);
    const now = new Date();
    // 设置时间为当天的开始（00:00:00），以便按天数比较
    endDate.setHours(0, 0, 0, 0);
    now.setHours(0, 0, 0, 0);
    const daysUntilEnd = Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    // 格式化日期显示
    endDateEl.textContent = formatTimeLocal(rowData.endDate).split(' ')[0];

    // 根据剩余天数添加样式类
    if (daysUntilEnd < 0) {
        endDateEl.className = "td-end-date end-date-expired";
    } else if (daysUntilEnd <= 3) {
        endDateEl.className = "td-end-date end-date-urgent";
    } else if (daysUntilEnd <= 7) {
        endDateEl.className = "td-end-date end-date-warning";
    } else {
        endDateEl.className = "td-end-date end-date-normal";
    }

    const btnView = $2<HTMLButtonElement>(tr, ".btn-view");
    const btnToggle = $2<HTMLButtonElement>(tr, ".btn-toggle");

    // 重新绑定事件（如果是更新现有行，需要清理旧事件）
    btnView.onclick = () => openAdDetailModal(ad);

    // 根据广告状态动态渲染操作按钮
    if (ad.status === "ACTIVE") {
        btnToggle.textContent = t("btn_pause_label");
        btnToggle.disabled = false;
        btnToggle.onclick = () => handleToggleAdStatus(ad.ad_id, "pause");
    } else if (ad.status === "PAUSED_MANUAL") {
        btnToggle.textContent = t("btn_resume_label");
        btnToggle.disabled = false;
        btnToggle.onclick = () => handleToggleAdStatus(ad.ad_id, "resume");
    } else if (ad.status === "PAUSED_NO_BUDGET") {
        btnToggle.textContent = t("btn_recharge_label");
        btnToggle.disabled = false;
        btnToggle.onclick = () => handleTopUpAdBudget(ad.ad_id);
    } else {
        // EXPIRED 或 COMPLETED
        btnToggle.textContent = "N/A";
        btnToggle.disabled = true;
        btnToggle.onclick = null;
    }
}

async function fetchAdClaimants(adId: string, page: number): Promise<{ claimants: ClaimantRecord[]; total: number }> {
    const currentXId = getCurrentXId();
    const offset = (page - 1) * claimantsModalState.pageSize;
    const response = await adsWorkerGet(API_PATH_ADS_PUBLISHER_AD_CLAIMS, {
        ad_id: adId,
        a_x_id: currentXId,
        limit: claimantsModalState.pageSize.toString(),
        offset: offset.toString()
    });

    if (!response?.success || !Array.isArray(response.claimants)) {
        throw new Error(response?.error || "Failed to load claimants");
    }

    return {
        claimants: response.claimants,
        total: Number(response.total || 0)
    };
}

function renderClaimantsList(claimants: ClaimantRecord[]) {
    const listEl = $Id("claimants-list");
    if (!listEl) return;

    listEl.replaceChildren();

    if (claimants.length === 0) {
        const emptyState = document.createElement("div");
        emptyState.className = "claimants-empty";
        emptyState.textContent = "No claimants yet";
        listEl.appendChild(emptyState);
        renderClaimantsPagination();
        return;
    }

    claimants.forEach((claimant) => {
        const item = document.createElement("div");
        item.className = "claimant-item";

        const avatar = document.createElement("img");
        avatar.className = "claimant-avatar";
        avatar.src = `https://unavatar.io/twitter/${encodeURIComponent(claimant.username || claimant.b_x_id)}`;
        avatar.alt = claimant.username || claimant.b_x_id;
        avatar.loading = "lazy";
        avatar.referrerPolicy = "no-referrer";
        avatar.onerror = () => {
            avatar.src =
                "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Ccircle cx='24' cy='24' r='24' fill='%23e5e7eb'/%3E%3Ctext x='24' y='30' text-anchor='middle' fill='%2394a3b8' font-size='20' font-family='Arial,sans-serif'%3E%F0%9F%91%A4%3C/text%3E%3C/svg%3E";
        };

        const main = document.createElement("div");
        main.className = "claimant-main";

        const topRow = document.createElement("div");
        topRow.className = "claimant-top-row";

        const nameBlock = document.createElement("div");
        nameBlock.className = "claimant-name-block";

        const nameEl = document.createElement("div");
        nameEl.className = "claimant-name";
        nameEl.textContent = claimant.username || claimant.b_x_id;

        const amountEl = document.createElement("div");
        amountEl.className = "claimant-amount";
        amountEl.textContent = formatUSDC(atomicToUsdcNumber(claimant.amount_atomic || "0"));

        nameBlock.appendChild(nameEl);
        topRow.appendChild(nameBlock);
        topRow.appendChild(amountEl);

        const metaRow = document.createElement("div");
        metaRow.className = "claimant-meta-row";

        const timeEl = document.createElement("span");
        timeEl.className = "claimant-time";
        timeEl.textContent = claimant.created_at ? formatTimeLocal(claimant.created_at) : "-";

        const statusEl = document.createElement("span");
        statusEl.className = "claimant-status";
        statusEl.textContent = CLAIMANT_STATUS_LABELS[claimant.status] || claimant.status || "-";

        metaRow.appendChild(timeEl);
        metaRow.appendChild(statusEl);

        main.appendChild(topRow);
        main.appendChild(metaRow);

        item.appendChild(avatar);
        item.appendChild(main);
        listEl.appendChild(item);
    });

    renderClaimantsPagination();
}

async function loadClaimantsPage(ad: AdRecord, page: number) {
    const listEl = $Id("claimants-list");
    if (!listEl) return;

    claimantsModalState.ad = ad;
    claimantsModalState.currentPage = Math.max(1, page);

    listEl.replaceChildren();
    const loadingState = document.createElement("div");
    loadingState.className = "claimants-empty";
    loadingState.textContent = "Loading claimants...";
    listEl.appendChild(loadingState);

    try {
        const { claimants, total } = await fetchAdClaimants(ad.ad_id, claimantsModalState.currentPage);
        claimantsModalState.totalCount = total;
        renderClaimantsList(claimants);
    } catch (err: any) {
        listEl.replaceChildren();
        const errorState = document.createElement("div");
        errorState.className = "claimants-empty claimants-empty--error";
        errorState.textContent = err?.message || "Failed to load claimants";
        listEl.appendChild(errorState);
        claimantsModalState.totalCount = 0;
        renderClaimantsPagination();
        showNotification(err?.message || "Failed to load claimants", "error");
    }
}

async function openClaimantsModal(ad: AdRecord) {
    const modal = ensureClaimantsModal();
    const titleEl = $Id("claimants-title");
    const listEl = $Id("claimants-list");
    if (!modal || !titleEl || !listEl) return;
    claimantsModalState.ad = ad;
    claimantsModalState.currentPage = 1;
    claimantsModalState.totalCount = 0;
    titleEl.textContent = `Claimants - ${ad.name}`;
    listEl.replaceChildren();
    bindClaimantsPaginationEvents();
    modal.classList.add("active");
    await loadClaimantsPage(ad, 1);
}

export function renderMyAdsTable() {
    const tbody = document.querySelector<HTMLTableSectionElement>("#my-ads-tbody");
    if (!tbody) return;

    tbody.replaceChildren();

    if (publisherState.ads.list.length === 0) {
        tbody.appendChild(cloneTemplate("tpl-empty-my-ads-row") as any);
        return;
    }

    publisherState.ads.list.forEach((ad) => {
        const tr = renderAdRow(ad);
        tbody.appendChild(tr);
    });
}

// ========= Ad Detail Modal =========
// 处理广告状态切换（启用/暂停/停止）
async function handleToggleAdStatus(adId: string, action: "pause" | "resume" | "stop") {
    try {
        showLoading();
        const currentXId = getCurrentXId();
        // x402WorkerFetch returns parsed JSON directly; throws on HTTP error
        const result = await adsWorkerFetch(API_PATH_ADS_TOGGLE_STATUS, {
            ad_id: adId,
            a_x_id: currentXId,
            action: action
        });

        let msg = "Success";
        if (action === "pause") msg = t("msg_ad_paused");
        if (action === "resume") msg = t("msg_ad_resumed");
        if (action === "stop") msg = t("msg_ad_ended_refund");
        showNotification(msg, "success");

        // 局部更新本地状态并更新 UI
        const ad = publisherState.ads.list.find(a => a.ad_id === adId);
        if (ad) {
            ad.status = result.new_status;
            updateAdRowUI(ad);
        } else {
            // 如果在当前列表没找到（可能跨页了），则刷新一次
            await refreshAdsData(publisherState.ads.currentPage);
        }
    } catch (err: any) {
        showNotification(err?.message || t("err_operation_failed"), "error");
    } finally {
        hideLoading();
    }
}

// 处理广告充值 - 打开弹窗
function handleTopUpAdBudget(adId: string) {
    const modal = $Id("top-up-budget-modal");
    if (!modal) return;

    // Reset Input
    const input = $Id("top-up-amount") as HTMLInputElement;
    if (input) input.value = "";

    // Show Balance
    // DEPRECATED: 获取余额的方式已更改，现在应通过新的dashboard API获取
    const balanceEl = $Id("top-up-available-balance");
    if (balanceEl) {
        balanceEl.textContent = formatUSDC(atomicToUsdcNumber(publisherState.dashboardInfo.balance_atomic));
    }

    // Bind Confirm Action
    const btnConfirm = $Id("btn-confirm-top-up");
    if (btnConfirm) {
        // Remove old listeners by cloning
        const newBtn = btnConfirm.cloneNode(true);
        btnConfirm.parentNode?.replaceChild(newBtn, btnConfirm);

        newBtn.addEventListener("click", () => handleTopUpSubmit(adId));
    }

    // Bind Cancel Action
    const btnCancel = $Id("btn-cancel-top-up");
    const btnClose = $Id("close-top-up-modal");
    const closeAction = () => modal.classList.remove("active");

    if (btnCancel) btnCancel.onclick = closeAction;
    if (btnClose) btnClose.onclick = closeAction;

    modal.classList.add("active");
}

// 处理充值提交
async function handleTopUpSubmit(adId: string) {
    try {
        const amountInput = $Id("top-up-amount") as HTMLInputElement;
        const amountStr = amountInput?.value;
        if (!amountStr) return;

        const amount = parseFloat(amountStr);
        if (isNaN(amount) || amount <= 0) {
            showNotification(t("err_enter_valid_amount"), "error");
            return;
        }

        const modal = $Id("top-up-budget-modal");

        showLoading();
        const currentXId = getCurrentXId();
        const amountAtomic = usdcToAtomic(amountStr);

        await adsWorkerFetch(API_PATH_ADS_TOP_UP_BUDGET, {
            ad_id: adId,
            a_x_id: currentXId,
            amount_atomic: amountAtomic
        });

        showNotification(t("msg_budget_topped_up"), "success");
        if (modal) modal.classList.remove("active");

        // 局部更新：即使是充值，也涉及余额变化，所以通常需要刷新 dashboard
        // 但对于单行，我们可以先假定它变成了 ACTIVE 并刷新当前页
        await fetchDashboardInfo(); // 更新顶部余额
        await refreshAdsData(publisherState.ads.currentPage);
    } catch (err: any) {
        showNotification(err?.message || t("err_recharge_failed"), "error");
    } finally {
        hideLoading();
    }
}

function openAdDetailModal(ad: AdRecord) {
    const modal = $Id("ad-detail-modal");
    if (!modal) return;

    // Populate Read-only fields
    const setText = (id: string, text: string) => {
        const el = $Id(id);
        if (el) el.textContent = text;
    };

    setText("detail-name", ad.name);

    // 更新状态显示
    const statusEl = $Id("detail-status");
    if (statusEl) {
        statusEl.textContent = AD_STATUS_LABELS[ad.status] || ad.status;
        statusEl.className = `detail-value status--${ad.status.toLowerCase().replace(/_/g, '-')}`;
    }

    setText("detail-created", ad.created_at ? formatTimeLocal(ad.created_at) : "-");

    const rewardUSDC = atomicToUsdcNumber(ad.unit_price_atomic);
    setText("detail-reward", formatUSDCForPublish(rewardUSDC));
    setText("detail-quota", ad.quota_total.toString());

    // End date
    const endDateEl = $Id("detail-end-date");
    if (endDateEl) {
        endDateEl.textContent = ad.end_date ? formatTimeLocal(ad.end_date) : "-";
    }

    // Populate Editable fields (Developer Settings)
    const callbackInput = $Id("detail-callback-url") as HTMLInputElement | null;
    if (callbackInput) callbackInput.value = ad.callback_url || "";

    const customDataInput = $Id("detail-custom-data") as HTMLTextAreaElement | null;
    if (customDataInput) customDataInput.value = ad.custom_data || "";

    const isEnded = ad.status === "EXPIRED" || ad.status === "COMPLETED";

    // ended（已决策）：不允许更新 callback/custom_data
    if (callbackInput) callbackInput.disabled = isEnded;
    if (customDataInput) customDataInput.disabled = isEnded;

    // Bind Update Button（ended 时禁用）
    const btnUpdate = $Id("btn-update-ad-settings");
    if (btnUpdate) {
        // Remove old listeners to prevent duplicates (cloning button is safer but simple replacement works here)
        const newBtn = btnUpdate.cloneNode(true) as HTMLButtonElement;
        btnUpdate.parentNode?.replaceChild(newBtn, btnUpdate);

        newBtn.disabled = isEnded;
        if (isEnded) {
            newBtn.title = t("err_ended_ads_no_update");
        } else {
            newBtn.title = "";
            newBtn.addEventListener("click", async () => {
                const newCallback = callbackInput?.value.trim() || null;
                const newCustomData = customDataInput?.value.trim() || null;

                // Validate JSON
                if (newCustomData) {
                    try {
                        JSON.parse(newCustomData);
                    } catch (e) {
                        showNotification(t("err_invalid_json_format"), "error");
                        return;
                    }
                }

                try {
                    showLoading("Updating ad settings...");
                    const payload = {
                        ad_id: ad.ad_id,
                        a_x_id: getCurrentXId(),
                        callback_url: newCallback,
                        custom_data: newCustomData,
                    };

                    const result = await adsWorkerFetch(API_PATH_ADS_UPDATE, payload);

                    if (result.ok) {
                        showNotification(t("msg_ad_settings_updated"), "success");
                        // 局部更新本地状态并刷新行 UI (主要为了让 View 按钮拿到最新引用)
                        const localAd = publisherState.ads.list.find(a => a.ad_id === ad.ad_id);
                        if (localAd) {
                            localAd.callback_url = newCallback;
                            localAd.custom_data = newCustomData;
                            updateAdRowUI(localAd);
                        }
                        modal.classList.remove("active");
                    } else {
                        const errorMsg = result.error?.detail || t("err_failed_update_ad");
                        showNotification(errorMsg, "error");
                    }
                } catch (err: any) {
                    showNotification(err.message, "error");
                } finally {
                    hideLoading();
                }
            });
        }
    }

    // 在模态框底部添加状态操作按钮
    const modalActions = $Id("ad-detail-modal-actions");
    if (modalActions) {
        // 清空现有按钮
        modalActions.replaceChildren();

        // 1. Pause/Resume/TopUp Buttons
        if (ad.status === "ACTIVE") {
            const btnPause = document.createElement("button");
            btnPause.className = "btn btn-warning";
            btnPause.textContent = t("btn_pause_ad");
            btnPause.onclick = async () => {
                modal.classList.remove("active");
                await handleToggleAdStatus(ad.ad_id, "pause");
            };
            modalActions.appendChild(btnPause);
        } else if (ad.status === "PAUSED_MANUAL") {
            const btnResume = document.createElement("button");
            btnResume.className = "btn btn-primary";
            btnResume.textContent = t("btn_resume_ad");
            btnResume.onclick = async () => {
                modal.classList.remove("active");
                await handleToggleAdStatus(ad.ad_id, "resume");
            };
            modalActions.appendChild(btnResume);
        } else if (ad.status === "PAUSED_NO_BUDGET") {
            const btnTopUp = document.createElement("button");
            btnTopUp.className = "btn btn-success";
            btnTopUp.textContent = t("btn_recharge_resume");
            btnTopUp.onclick = async () => {
                modal.classList.remove("active");
                handleTopUpAdBudget(ad.ad_id);
            };
            modalActions.appendChild(btnTopUp);
        }

        // 2. Add Budget Button (for Active/Paused)
        if (ad.status === "ACTIVE" || ad.status === "PAUSED_MANUAL") {
            const btnAddBudget = document.createElement("button");
            btnAddBudget.className = "btn btn-success";
            btnAddBudget.textContent = t("btn_add_budget");
            btnAddBudget.onclick = () => {
                modal.classList.remove("active");
                handleTopUpAdBudget(ad.ad_id);
            };
            modalActions.appendChild(btnAddBudget);
        }

        // 3. Stop Button (End Campaign) - 仅允许 Active/PausedManual
        // 将其作为危险操作放在最后
        if (ad.status === "ACTIVE" || ad.status === "PAUSED_MANUAL") {
            const btnStop = document.createElement("button");
            btnStop.className = "btn btn-danger"; // Ensure you have danger style or use inline style
            btnStop.style.backgroundColor = "var(--color-danger, #dc3545)";
            btnStop.style.color = "white";
            btnStop.textContent = t("btn_end_campaign");
            btnStop.onclick = async () => {
                const confirmed = await showConfirm(t("confirm_end_campaign"));
                if (!confirmed) return;

                modal.classList.remove("active");
                await handleToggleAdStatus(ad.ad_id, "stop");
            };
            modalActions.appendChild(btnStop);
        }
    }

    // Show Modal
    modal.classList.add("active");

    // Bind Close Button
    const btnClose = $Id("close-ad-detail");
    if (btnClose) {
        btnClose.onclick = () => modal.classList.remove("active");
    }
}

// ========= Recent Spending =========
export function renderSpendTable() {
    const tbody = document.querySelector<HTMLTableSectionElement>("#spending-tbody");
    if (!tbody) return;

    tbody.replaceChildren();

    if (publisherState.spend.list.length === 0) {
        tbody.appendChild(cloneTemplate("tpl-empty-spend-row") as any);
        return;
    }

    publisherState.spend.list.forEach((r) => {
        const tr = cloneTemplate("tpl-spend-row") as HTMLTableRowElement;
        tr.dataset.id = r.id;

        $2<HTMLElement>(tr, ".td-time").textContent = formatTimeLocal(r.time);
        $2<HTMLElement>(tr, ".td-ad").textContent = r.adName;
        $2<HTMLElement>(tr, ".td-event").textContent = r.event;
        $2<HTMLElement>(tr, ".td-amount").textContent = formatUSDC(r.amount);
        $2<HTMLElement>(tr, ".td-fee").textContent = formatUSDC(r.fee);
        $2<HTMLElement>(tr, ".td-status").textContent = r.status;

        tbody.appendChild(tr);
    });
}

// ========= Wizard Step4 预算摘要（为避免循环依赖放这里） =========
function formatUSDCForPublish(amount: number): string {
    return formatUSDCTrimmed(amount);
}

export function updateBudgetSummaryAndBalance() {
    const rewardInput = document.querySelector<HTMLInputElement>("#reward-amount");
    const taskLimitInput = document.querySelector<HTMLInputElement>("#task-limit");

    const reward = rewardInput?.value || "0";
    const tasks = Number(taskLimitInput?.value || "0");

    const unitAtomic = usdcToAtomic(reward);
    const requiredAtomic = unitAtomic && Number.isFinite(tasks) ? multiplyAtomic(unitAtomic, tasks) : "0";
    const requiredUsdc = atomicToUsdcNumber(requiredAtomic);

    const fee = 0;
    const total = requiredUsdc + fee;

    const summaryReward = $Id("summary-reward");
    if (summaryReward) summaryReward.textContent = formatUSDCForPublish(Number(reward) || 0);

    const summaryTasks = $Id("summary-tasks");
    if (summaryTasks) summaryTasks.textContent = Number.isFinite(tasks) ? tasks.toString() : "0";

    const summaryTotal = $Id("summary-total");
    if (summaryTotal) summaryTotal.textContent = formatUSDCForPublish(total);

    const currentBalance = $Id("current-balance");
    if (currentBalance) currentBalance.textContent = formatUSDC(atomicToUsdcNumber(publisherState.dashboardInfo.balance_atomic));

    const balanceStatus = $Id("balance-status");
    if (balanceStatus) {
        balanceStatus.className = "balance-status";

        if (requiredAtomic && BigInt(requiredAtomic) > 0n && BigInt(publisherState.dashboardInfo.balance_atomic) >= BigInt(requiredAtomic)) {
            balanceStatus.classList.add("sufficient");
            balanceStatus.textContent = t("msg_sufficient_balance");
        } else if (requiredAtomic && BigInt(requiredAtomic) > 0n && BigInt(publisherState.dashboardInfo.balance_atomic) < BigInt(requiredAtomic)) {
            balanceStatus.classList.add("insufficient");
            balanceStatus.textContent = t("msg_insufficient_balance_recharge");
        } else {
            balanceStatus.textContent = "";
        }
    }
}

// ========= 顶部返回 / Spend Tabs =========
export function initNavEvents() {
    const btnBack = $Id("btn-back-plaza") as HTMLButtonElement | null;
    if (btnBack) btnBack.addEventListener("click", () => {
        window.location.href = "ad_plaza.html";
    });

    const chainInfoCont = document.querySelector(".chain-info");
    const hoverPanel = document.querySelector(".chain-hover-panel");

    if (chainInfoCont && hoverPanel) {
        chainInfoCont.addEventListener("click", (e) => {
            e.stopPropagation();
            hoverPanel.classList.toggle("active");
        });

        window.addEventListener("click", (e) => {
            if (!chainInfoCont.contains(e.target as Node) && !hoverPanel.contains(e.target as Node)) {
                hoverPanel.classList.remove("active");
            }
        });
    }

    const addrWrapper = $Id("header-account-wrapper");
    if (addrWrapper) {
        addrWrapper.addEventListener("click", async () => {
            const addr = publisherState.walletInfoCache?.address;
            if (addr) {
                await navigator.clipboard.writeText(addr);
                showNotification(t("copy_success"), "success");
            }
        });
    }
}

export function initSpendTabs() {
    const group = document.querySelector<HTMLElement>('.dashboard-group[data-group="spend"]');
    if (!group) return;

    const tabs = Array.from(group.querySelectorAll<HTMLButtonElement>(".dashboard-tab"));
    const cards = Array.from(group.querySelectorAll<HTMLElement>('.dashboard-card[data-range]'));

    if (tabs.length === 0 || cards.length === 0) return;

    const setRange = (range: string) => {
        tabs.forEach((t) => t.classList.toggle("active", (t.dataset.range || "") === range));
        cards.forEach((c) => c.classList.toggle("is-hidden", (c.dataset.range || "") !== range));
    };

    const defaultRange =
        tabs.find((t) => t.classList.contains("active"))?.dataset.range ||
        tabs[0].dataset.range ||
        "today";

    setRange(defaultRange);

    tabs.forEach((t) => {
        t.addEventListener("click", () => setRange(t.dataset.range || "today"));
    });
}

// ========= History Modal（归入 Activity 模块） =========
function openHistoryModal(defaultTab: "earnings" | "spending" | "recharge" = "spending") {
    const modal = $Id("history-modal");
    if (modal) modal.classList.add("active");
    switchHistoryTab(defaultTab);
}

function closeHistoryModal() {
    const modal = $Id("history-modal");
    if (modal) modal.classList.remove("active");
}

function renderHistoryTable(tab: "earnings" | "spending" | "recharge", rows: HistoryRow[]) {
    if (tab !== "recharge") return;

    const tbody = document.querySelector<HTMLTableSectionElement>("#recharge-history-tbody");
    if (!tbody) return;

    tbody.replaceChildren();

    if (rows.length === 0) {
        const tr = cloneTemplate("tpl-empty-history-row") as HTMLTableRowElement;
        $2<HTMLElement>(tr, ".td-empty").textContent = t("msg_no_transfer_records");
        tbody.appendChild(tr);
        return;
    }

    rows.forEach((row) => {
        const tr = cloneTemplate("tpl-history-row") as HTMLTableRowElement;
        const isDeposit = row.adNameOrMethod === t("btn_wallet_to_ads");
        const isWithdraw = row.adNameOrMethod === t("btn_ads_to_wallet");

        if (isDeposit) tr.classList.add("history-row--deposit");
        else if (isWithdraw) tr.classList.add("history-row--withdraw");

        $2<HTMLElement>(tr, ".td-time").textContent = row.time;

        const directionCell = $2<HTMLElement>(tr, ".td-name");
        directionCell.textContent = row.adNameOrMethod;
        if (isDeposit) directionCell.classList.add("direction-deposit");
        else if (isWithdraw) directionCell.classList.add("direction-withdraw");

        const amountCell = $2<HTMLElement>(tr, ".td-amount");
        amountCell.textContent = formatUSDC(row.amount);
        if (isDeposit) amountCell.classList.add("amount-deposit");
        else if (isWithdraw) amountCell.classList.add("amount-withdraw");

        $2<HTMLElement>(tr, ".td-status").textContent = row.status;

        const txHashCell = $2<HTMLElement>(tr, ".td-txhash");
        if (row.txHash) {
            const shortHash = `${row.txHash.slice(0, 6)}...${row.txHash.slice(-4)}`;
            txHashCell.innerHTML = `<span class="tx-hash-link" title="Click to view on block explorer\n${row.txHash}">${shortHash}</span>`;

            const linkSpan = txHashCell.querySelector(".tx-hash-link") as HTMLElement;
            if (linkSpan) {
                linkSpan.style.cursor = "pointer";
                linkSpan.addEventListener("click", (e) => {
                    e.stopPropagation();
                    openTxInExplorer(row.txHash!);
                });
            }
        } else {
            txHashCell.textContent = "—";
            txHashCell.style.color = "#d1d5db";
        }

        tbody.appendChild(tr);
    });
}

function switchHistoryTab(tab: "earnings" | "spending" | "recharge") {
    if (tab === "recharge") renderHistoryTable("recharge", publisherState.historyRecharge);
}

export async function loadAndRenderTransferHistory(): Promise<void> {
    const currentXId = getCurrentXId();

    const tbody = document.querySelector<HTMLTableSectionElement>("#recharge-history-tbody");
    if (tbody) {
        tbody.replaceChildren();
        const loadingTr = cloneTemplate("tpl-empty-history-row") as HTMLTableRowElement;
        $2<HTMLElement>(loadingTr, ".td-empty").textContent = t("loading_history");
        tbody.appendChild(loadingTr);
    }

    const ledgerRows = await fetchAdEscrowLedger(currentXId, 50, 0);

    const mappedRows: HistoryRow[] = ledgerRows.map((row: any) => {
        const time = row.created_at ? new Date(row.created_at).toLocaleString() : new Date().toLocaleString();

        const op = row.op || row.direction || "UNKNOWN";
        const adNameOrMethod =
            op === "DEPOSIT" ? t("btn_wallet_to_ads") :
                op === "WITHDRAW" ? t("btn_ads_to_wallet") : op;

        const amount = atomicToUsdcNumber(row.amount_atomic || "0");

        let status = row.status || "UNKNOWN";
        if (status === "FAILED" && row.error_reason) {
            const errorMsg = String(row.error_reason).slice(0, 30);
            status = `Failed: ${errorMsg}`;
        }

        return { time, adNameOrMethod, amount, status, txHash: row.tx_hash || null };
    });

    publisherState.historyRecharge = mappedRows;
    renderHistoryTable("recharge", mappedRows);
}

export function initHistoryModalEvents() {
    const btnHistory = $Id("btn-history") as HTMLButtonElement | null;
    if (btnHistory) {
        btnHistory.addEventListener("click", async () => {
            openHistoryModal("recharge");
            try {
                await loadAndRenderTransferHistory();
            } catch (err: any) {
                const tbody = document.querySelector<HTMLTableSectionElement>("#recharge-history-tbody");
                if (!tbody) return;
                tbody.replaceChildren();
                const errorTr = cloneTemplate("tpl-empty-history-row") as HTMLTableRowElement;
                const errorMsg = err?.message || t("err_load_history_failed");
                $2<HTMLElement>(errorTr, ".td-empty").textContent = `Error: ${errorMsg}`;
                tbody.appendChild(errorTr);
            }
        });
    }

    const closeHistory = $Id("close-history") as HTMLButtonElement | null;
    if (closeHistory) closeHistory.addEventListener("click", closeHistoryModal);
}

export function initClaimantsModalEvents() {
    const modal = ensureClaimantsModal();
    if (!modal) return;

    const closeModal = () => {
        claimantsModalState.ad = null;
        claimantsModalState.currentPage = 1;
        claimantsModalState.totalCount = 0;
        modal.classList.remove("active");
    };

    const btnClose = $Id("close-claimants") as HTMLButtonElement | null;
    if (btnClose) btnClose.addEventListener("click", closeModal);

    modal.addEventListener("click", (e) => {
        if (e.target === modal) closeModal();
    });
}
