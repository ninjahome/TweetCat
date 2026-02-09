import {
    $2,
    $Id,
    atomicToUsdcNumber,
    cloneTemplate,
    formatUSDC,
    hideLoading,
    multiplyAtomic,
    showLoading,
    showNotification,
    usdcToAtomic
} from "../common";
import { logAdP } from "../../common/debug_flags";
import type { AdRecord, AdStatus, HistoryRow } from "./ad_publisher_common";
import {
    API_PATH_ADS_MY_ADS,
    API_PATH_ADS_PUBLISHER_DASHBOARD_INFO,
    API_PATH_ADS_PUBLISHER_SPEND_HISTORY,
    API_PATH_ADS_TOGGLE_STATUS,
    API_PATH_ADS_TOP_UP_BUDGET,
    API_PATH_ADS_UPDATE,
    fetchAdEscrowLedger,
    getCurrentXId,
    openTxInExplorer,
    publisherState
} from "./ad_publisher_common";
import { x402WorkerFetch, x402WorkerGet } from "../../wallet/cdp_wallet";

// 状态显示名称映射
const AD_STATUS_LABELS: Record<string, string> = {
    'ACTIVE': 'Active',
    'PAUSED_MANUAL': 'Paused',
    'PAUSED_NO_BUDGET': 'Paused (No Budget)',
    'EXPIRED': 'Ended',
    'COMPLETED': 'Ended'
};

// ========= 数据刷新 =========
export async function refreshAdsData(page: number = 1) {
    if (publisherState.ads.isLoading) return; // 简单的锁，防止重复点击导致的竞态

    const currentXId = getCurrentXId();
    const { pageSize } = publisherState.ads;
    const offset = (page - 1) * pageSize;

    publisherState.ads.isLoading = true;

    try {
        const response = await x402WorkerGet(API_PATH_ADS_MY_ADS, {
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
    const currentXId = getCurrentXId();

    try {
        const dashboardInfo = await x402WorkerGet(API_PATH_ADS_PUBLISHER_DASHBOARD_INFO, { a_x_id: currentXId });
        console.log("Dashboard info:", dashboardInfo);
        logAdP("Dashboard info:", dashboardInfo);

        // 更新 publisherState.dashboardInfo 以供其他组件使用
        publisherState.dashboardInfo = {
            balance_atomic: dashboardInfo.balance_atomic,
            frozen_atomic: dashboardInfo.frozen_atomic,
            active_campaigns_count: dashboardInfo.active_campaigns_count,
            today_spend_atomic: dashboardInfo.today_spend_atomic,
            week_spend_atomic: dashboardInfo.week_spend_atomic
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
    if (publisherState.spend.isLoading) return;

    const currentXId = getCurrentXId();
    const { pageSize } = publisherState.spend;
    const offset = (page - 1) * pageSize;

    publisherState.spend.isLoading = true;

    try {
        // 获取消费历史记录
        const response = await x402WorkerGet(API_PATH_ADS_PUBLISHER_SPEND_HISTORY, {
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
    if (pageInfo) pageInfo.textContent = `Page ${currentPage} / ${maxPage}`;

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

    $2<HTMLElement>(tr, ".td-reward").textContent = formatUSDC(rowData.rewardPerTask);
    // “Completed”列当前展示 claimed（占位/已领取），避免误把领取当成已结算消耗
    $2<HTMLElement>(tr, ".td-completed").textContent = rowData.claimed.toString();
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
    endDateEl.textContent = new Date(rowData.endDate).toLocaleDateString();

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
        btnToggle.textContent = "暂停";
        btnToggle.disabled = false;
        btnToggle.onclick = () => handleToggleAdStatus(ad.ad_id, "pause");
    } else if (ad.status === "PAUSED_MANUAL") {
        btnToggle.textContent = "启用";
        btnToggle.disabled = false;
        btnToggle.onclick = () => handleToggleAdStatus(ad.ad_id, "resume");
    } else if (ad.status === "PAUSED_NO_BUDGET") {
        btnToggle.textContent = "充值";
        btnToggle.disabled = false;
        btnToggle.onclick = () => handleTopUpAdBudget(ad.ad_id);
    } else {
        // EXPIRED 或 COMPLETED
        btnToggle.textContent = "N/A";
        btnToggle.disabled = true;
        btnToggle.onclick = null;
    }
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
// 处理广告状态切换（启用/暂停）
async function handleToggleAdStatus(adId: string, action: "pause" | "resume") {
    try {
        showLoading();
        const currentXId = getCurrentXId();
        const response = await x402WorkerFetch(API_PATH_ADS_TOGGLE_STATUS, {
            ad_id: adId,
            a_x_id: currentXId,
            action: action
        });

        if (response.ok) {
            const result = await response.json();
            showNotification(action === "pause" ? "广告已暂停" : "广告已启用", "success");

            // 局部更新本地状态并更新 UI
            const ad = publisherState.ads.list.find(a => a.ad_id === adId);
            if (ad) {
                ad.status = result.new_status;
                updateAdRowUI(ad);
            } else {
                // 如果在当前列表没找到（可能跨页了），则刷新一次
                await refreshAdsData(publisherState.ads.currentPage);
            }
        } else {
            const error = await response.json();
            showNotification(error.detail || "操作失败", "error");
        }
    } catch (err: any) {
        showNotification(err?.message || "操作失败", "error");
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
            showNotification("请输入有效的金额", "error");
            return;
        }

        const modal = $Id("top-up-budget-modal");

        showLoading();
        const currentXId = getCurrentXId();
        const amountAtomic = usdcToAtomic(amountStr);

        await x402WorkerFetch(API_PATH_ADS_TOP_UP_BUDGET, {
            ad_id: adId,
            a_x_id: currentXId,
            amount_atomic: amountAtomic
        });

        showNotification("预算追加成功", "success");
        if (modal) modal.classList.remove("active");

        // 局部更新：即使是充值，也涉及余额变化，所以通常需要刷新 dashboard
        // 但对于单行，我们可以先假定它变成了 ACTIVE 并刷新当前页
        await fetchDashboardInfo(); // 更新顶部余额
        await refreshAdsData(publisherState.ads.currentPage);
    } catch (err: any) {
        showNotification(err?.message || "充值失败", "error");
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

    setText("detail-created", ad.created_at ? new Date(ad.created_at).toLocaleString() : "-");

    const rewardUSDC = atomicToUsdcNumber(ad.unit_price_atomic);
    setText("detail-reward", formatUSDC(rewardUSDC));
    setText("detail-quota", ad.quota_total.toString());

    // End date
    const endDateEl = $Id("detail-end-date");
    if (endDateEl) {
        endDateEl.textContent = ad.end_date ? new Date(ad.end_date).toLocaleString() : "-";
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
            newBtn.title = "Ended ads cannot be updated.";
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
                        showNotification("Invalid JSON format in Custom Data", "error");
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

                    const result = await x402WorkerFetch(API_PATH_ADS_UPDATE, payload);

                    if (result.ok) {
                        showNotification("Ad settings updated successfully!", "success");
                        // 局部更新本地状态并刷新行 UI (主要为了让 View 按钮拿到最新引用)
                        const localAd = publisherState.ads.list.find(a => a.ad_id === ad.ad_id);
                        if (localAd) {
                            localAd.callback_url = newCallback;
                            localAd.custom_data = newCustomData;
                            updateAdRowUI(localAd);
                        }
                        modal.classList.remove("active");
                    } else {
                        const errorMsg = result.error?.detail || "Failed to update ad";
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

        // 根据广告状态动态生成按钮
        if (ad.status === "ACTIVE") {
            const btnPause = document.createElement("button");
            btnPause.className = "btn btn-warning";
            btnPause.textContent = "暂停广告";
            btnPause.onclick = async () => {
                modal.classList.remove("active");
                await handleToggleAdStatus(ad.ad_id, "pause");
            };
            modalActions.appendChild(btnPause);
        } else if (ad.status === "PAUSED_MANUAL") {
            const btnResume = document.createElement("button");
            btnResume.className = "btn btn-primary";
            btnResume.textContent = "启用广告";
            btnResume.onclick = async () => {
                modal.classList.remove("active");
                await handleToggleAdStatus(ad.ad_id, "resume");
            };
            modalActions.appendChild(btnResume);
        } else if (ad.status === "PAUSED_NO_BUDGET") {
            const btnTopUp = document.createElement("button");
            btnTopUp.className = "btn btn-success";
            btnTopUp.textContent = "充值并启用";
            btnTopUp.onclick = async () => {
                modal.classList.remove("active");
                handleTopUpAdBudget(ad.ad_id);
            };
            modalActions.appendChild(btnTopUp);
        }

        // 统一：为 ACTIVE, PAUSED_MANUAL, PAUSED_NO_BUDGET 状态提供一个通用的“追加预算”按钮
        if (ad.status === "ACTIVE" || ad.status === "PAUSED_MANUAL") {
            const btnAddBudget = document.createElement("button");
            btnAddBudget.className = "btn btn-success";
            btnAddBudget.textContent = "追加预算";
            btnAddBudget.onclick = () => {
                modal.classList.remove("active");
                handleTopUpAdBudget(ad.ad_id);
            };
            modalActions.appendChild(btnAddBudget);
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

        $2<HTMLElement>(tr, ".td-time").textContent = r.time;
        $2<HTMLElement>(tr, ".td-ad").textContent = r.adName;
        $2<HTMLElement>(tr, ".td-event").textContent = r.event;
        $2<HTMLElement>(tr, ".td-amount").textContent = formatUSDC(r.amount);
        $2<HTMLElement>(tr, ".td-fee").textContent = formatUSDC(r.fee);
        $2<HTMLElement>(tr, ".td-status").textContent = r.status;

        tbody.appendChild(tr);
    });
}

// ========= Wizard Step4 预算摘要（为避免循环依赖放这里） =========
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
    if (summaryReward) summaryReward.textContent = formatUSDC(Number(reward) || 0);

    const summaryTasks = $Id("summary-tasks");
    if (summaryTasks) summaryTasks.textContent = Number.isFinite(tasks) ? tasks.toString() : "0";

    const summaryTotal = $Id("summary-total");
    if (summaryTotal) summaryTotal.textContent = formatUSDC(total);

    const currentBalance = $Id("current-balance");
    if (currentBalance) currentBalance.textContent = formatUSDC(atomicToUsdcNumber(publisherState.dashboardInfo.balance_atomic));

    const balanceStatus = $Id("balance-status");
    if (balanceStatus) {
        balanceStatus.className = "balance-status";

        if (requiredAtomic && BigInt(requiredAtomic) > 0n && BigInt(publisherState.dashboardInfo.balance_atomic) >= BigInt(requiredAtomic)) {
            balanceStatus.classList.add("sufficient");
            balanceStatus.textContent = "Your balance is sufficient to publish this ad.";
        } else if (requiredAtomic && BigInt(requiredAtomic) > 0n && BigInt(publisherState.dashboardInfo.balance_atomic) < BigInt(requiredAtomic)) {
            balanceStatus.classList.add("insufficient");
            balanceStatus.textContent = "Insufficient balance. Please recharge before publishing.";
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
        $2<HTMLElement>(tr, ".td-empty").textContent = "No transfer records yet";
        tbody.appendChild(tr);
        return;
    }

    rows.forEach((row) => {
        const tr = cloneTemplate("tpl-history-row") as HTMLTableRowElement;

        const isDeposit = row.adNameOrMethod.includes("Wallet → Ads");
        const isWithdraw = row.adNameOrMethod.includes("Ads → Wallet");

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

async function loadAndRenderTransferHistory(): Promise<void> {
    const currentXId = getCurrentXId();

    const tbody = document.querySelector<HTMLTableSectionElement>("#recharge-history-tbody");
    if (tbody) {
        tbody.replaceChildren();
        const loadingTr = cloneTemplate("tpl-empty-history-row") as HTMLTableRowElement;
        $2<HTMLElement>(loadingTr, ".td-empty").textContent = "Loading transfer history...";
        tbody.appendChild(loadingTr);
    }

    const ledgerRows = await fetchAdEscrowLedger(currentXId, 50, 0);

    const mappedRows: HistoryRow[] = ledgerRows.map((row: any) => {
        const time = row.created_at ? new Date(row.created_at).toLocaleString() : new Date().toLocaleString();

        const op = row.op || row.direction || "UNKNOWN";
        const adNameOrMethod =
            op === "DEPOSIT" ? "Wallet → Ads" :
                op === "WITHDRAW" ? "Ads → Wallet" : op;

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
                const errorMsg = err?.message || "Failed to load history";
                $2<HTMLElement>(errorTr, ".td-empty").textContent = `Error: ${errorMsg}`;
                tbody.appendChild(errorTr);
            }
        });
    }

    const closeHistory = $Id("close-history") as HTMLButtonElement | null;
    if (closeHistory) closeHistory.addEventListener("click", closeHistoryModal);
}
