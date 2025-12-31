import browser from "webextension-polyfill";
import {queryCdpUserID} from "../wallet/cdp_wallet";
import {showLoading, hideLoading, showNotification, x402WorkerFetch, x402WorkerGet} from "./common";
import {getChainId} from "../wallet/wallet_setting";
import {X402_FACILITATORS} from "../common/x402_obj";
import {initI18n, t} from "../common/i18n";

interface Reward {
    id: number;
    cdp_user_id: string;
    asset_symbol: string;
    asset_address: string | null;
    amount_atomic: string;
    status: number;
    tx_hash: string | null;
    reason: string | null;
    created_at: string;
    updated_at: string;
}

interface HistoryResponse {
    success: boolean;
    data: {
        rewards: Reward[];
        hasMore: boolean;
        pageStart: number;
        pageSize: number;
    };
}

let currentStatus = -1;
let currentPageStart = 0;
let hasMorePages = false;

document.addEventListener("DOMContentLoaded", () => {
    initI18n();
    initRewardsTexts();
    initRewardsPage().then();
});

function initRewardsTexts() {
    // 页面标题
    document.title = t('rewards_page_title');
    const pageTitle = document.querySelector('.rewards-header h1');
    if (pageTitle) {
        pageTitle.textContent = t('rewards_page_title');
    }
    
    // 筛选标签
    const filterLabel = document.querySelector('.filter-container label');
    if (filterLabel) {
        filterLabel.textContent = t('rewards_filter_label') + ':';
    }
    
    // 状态筛选下拉框选项
    const statusFilter = document.getElementById('status-filter') as HTMLSelectElement;
    if (statusFilter) {
        const options = statusFilter.options;
        if (options[0]) options[0].textContent = t('rewards_filter_all');
        if (options[1]) options[1].textContent = t('rewards_status_pending');
        if (options[2]) options[2].textContent = t('rewards_status_locked');
        if (options[3]) options[3].textContent = t('rewards_status_success');
        if (options[4]) options[4].textContent = t('rewards_status_failed');
        if (options[5]) options[5].textContent = t('rewards_status_cancelled');
    }
    
    // 分页按钮
    const prevBtn = document.getElementById('prev-page');
    if (prevBtn) {
        prevBtn.textContent = t('rewards_prev_page');
    }
    
    const nextBtn = document.getElementById('next-page');
    if (nextBtn) {
        nextBtn.textContent = t('rewards_next_page');
    }
    
    const pageInfo = document.getElementById('page-info');
    if (pageInfo) {
        pageInfo.textContent = t('rewards_page_info', '1');
    }
    
    // 空状态提示
    const emptyState = document.getElementById('empty-state');
    if (emptyState) {
        const emptyText = emptyState.querySelector('p');
        if (emptyText) {
            emptyText.textContent = t('rewards_empty_state');
        }
    }
    
    // Loading 文本
    const loadingMessage = document.querySelector('.loading-message');
    if (loadingMessage) {
        loadingMessage.textContent = t('rewards_loading');
    }
}

async function initRewardsPage() {
    // 从 URL 获取参数
    const urlParams = new URLSearchParams(window.location.search);
    currentStatus = parseInt(urlParams.get("status") || "-1");

    // 设置状态筛选的默认值
    const statusFilter = document.getElementById("status-filter") as HTMLSelectElement;
    if (statusFilter) {
        statusFilter.value = currentStatus.toString();
        statusFilter.addEventListener("change", handleStatusChange);
    }

    // 设置分页按钮事件
    const prevBtn = document.getElementById("prev-page") as HTMLButtonElement;
    const nextBtn = document.getElementById("next-page") as HTMLButtonElement;

    if (prevBtn) {
        prevBtn.addEventListener("click", handlePrevPage);
    }

    if (nextBtn) {
        nextBtn.addEventListener("click", handleNextPage);
    }

    // 加载奖励数据
    await loadRewards();
}

async function handleStatusChange(event: Event) {
    const select = event.target as HTMLSelectElement;
    currentStatus = parseInt(select.value);
    currentPageStart = 0;
    await loadRewards();
}

async function handlePrevPage() {
    if (currentPageStart > 0) {
        currentPageStart = Math.max(0, currentPageStart - 20);
        await loadRewards();
    }
}

async function handleNextPage() {
    if (hasMorePages) {
        currentPageStart += 20;
        await loadRewards();
    }
}

async function loadRewards() {
    showLoading(t('rewards_loading'));

    try {
        const cdpUserId = await queryCdpUserID();
        if (!cdpUserId) {
            showNotification(t('rewards_user_id_not_found'), "error");
            return;
        }

        const response: HistoryResponse = await x402WorkerGet("/rewards/query_history", {
            cdp_user_id: cdpUserId,
            status: currentStatus.toString(),
            page_start: currentPageStart.toString()
        });

        if (response.success && response.data) {
            const {rewards, hasMore} = response.data;
            hasMorePages = hasMore;

            // 更新分页按钮状态
            updatePaginationButtons();

            // 渲染奖励列表
            renderRewardsList(rewards);
        }
    } catch (error) {
        console.error("加载奖励失败:", error);
        showNotification(t('rewards_load_failed') + ": " + (error as Error).message, "error");
    } finally {
        hideLoading();
    }
}

function updatePaginationButtons() {
    const prevBtn = document.getElementById("prev-page") as HTMLButtonElement;
    const nextBtn = document.getElementById("next-page") as HTMLButtonElement;
    const pageInfo = document.getElementById("page-info") as HTMLSpanElement;

    if (prevBtn) {
        prevBtn.disabled = currentPageStart === 0;
    }

    if (nextBtn) {
        nextBtn.disabled = !hasMorePages;
    }

    if (pageInfo) {
        const currentPage = Math.floor(currentPageStart / 20) + 1;
        pageInfo.textContent = t('rewards_page_info', currentPage.toString());
    }
}

function renderRewardsList(rewards: Reward[]) {
    const listContainer = document.getElementById("rewards-list") as HTMLElement;
    const emptyState = document.getElementById("empty-state") as HTMLElement;

    if (!listContainer) return;

    listContainer.innerHTML = "";

    if (rewards.length === 0) {
        listContainer.style.display = "none";
        if (emptyState) {
            emptyState.style.display = "block";
        }
        return;
    }

    listContainer.style.display = "block";
    if (emptyState) {
        emptyState.style.display = "none";
    }

    rewards.forEach(reward => {
        const rewardItem = createRewardItem(reward);
        listContainer.appendChild(rewardItem);
    });
}

function createRewardItem(reward: Reward): HTMLElement {
    const div = document.createElement("div");
    div.className = "reward-item";
    div.dataset.rewardId = reward.id.toString();

    // 折叠状态内容
    const collapsedContent = document.createElement("div");
    collapsedContent.className = "reward-collapsed";

    const basicInfo = document.createElement("div");
    basicInfo.className = "reward-basic-info";

    // ID
    const idField = createField(t('rewards_field_id'), reward.id.toString());
    basicInfo.appendChild(idField);

    // 资产
    const assetField = createField(t('rewards_field_asset'), reward.asset_symbol);
    basicInfo.appendChild(assetField);

    // 金额
    const amount = Number(reward.amount_atomic) / 1e6;
    const amountField = createField(t('rewards_field_amount'), amount.toFixed(6));
    amountField.querySelector(".reward-field-value")?.classList.add("reward-amount");
    basicInfo.appendChild(amountField);

    // 状态
    const statusField = createStatusBadge(reward.status);
    basicInfo.appendChild(statusField);

    // 创建时间
    const createdAtField = createField(t('rewards_field_created_at'), formatDate(reward.created_at));
    basicInfo.appendChild(createdAtField);

    collapsedContent.appendChild(basicInfo);
    div.appendChild(collapsedContent);

    // 展开状态内容
    const expandedContent = document.createElement("div");
    expandedContent.className = "reward-expanded";

    const detailGrid = document.createElement("div");
    detailGrid.className = "reward-detail-grid";

    // 更新时间
    const updatedAtField = createField(t('rewards_field_updated_at'), formatDate(reward.updated_at));
    detailGrid.appendChild(updatedAtField);

    // 原因
    if (reward.reason) {
        const reasonField = createField(t('rewards_field_reason'), reward.reason);
        detailGrid.appendChild(reasonField);
    }

    // 交易哈希
    if (reward.tx_hash) {
        const txField = createField(t('rewards_field_tx_hash'), reward.tx_hash.substring(0, 16) + "...");
        detailGrid.appendChild(txField);
    }

    // 资产地址
    if (reward.asset_address) {
        const addressField = createField(t('rewards_field_asset_address'), reward.asset_address.substring(0, 16) + "...");
        detailGrid.appendChild(addressField);
    }

    expandedContent.appendChild(detailGrid);

    // 操作按钮
    if (reward.status === 0) {
        const actions = document.createElement("div");
        actions.className = "reward-actions";

        const claimBtn = document.createElement("button");
        claimBtn.className = "btn-claim";
        claimBtn.textContent = t('rewards_btn_claim');
        claimBtn.onclick = async (e) => {
            e.stopPropagation();
            await handleClaimReward(reward.id);
        };

        actions.appendChild(claimBtn);
        expandedContent.appendChild(actions);
    }

    // 如果有交易哈希，添加查看按钮
    if (reward.tx_hash) {
        const actions = expandedContent.querySelector(".reward-actions") || document.createElement("div");
        if (!actions.parentElement) {
            actions.className = "reward-actions";
            expandedContent.appendChild(actions);
        }

        const viewTxBtn = document.createElement("button");
        viewTxBtn.className = "btn-claim";
        viewTxBtn.textContent = t('rewards_btn_view_tx');
        viewTxBtn.onclick = async (e) => {
            e.stopPropagation();
            const chainId = await getChainId();
            await browser.tabs.create({
                url: X402_FACILITATORS[chainId].browser + "/tx/" + reward.tx_hash
            });
        };

        actions.appendChild(viewTxBtn);
    }

    div.appendChild(expandedContent);

    // 点击切换展开/折叠
    div.onclick = () => {
        div.classList.toggle("expanded");
    };

    return div;
}

function createField(label: string, value: string): HTMLElement {
    const div = document.createElement("div");
    div.className = "reward-field";

    const labelEl = document.createElement("div");
    labelEl.className = "reward-field-label";
    labelEl.textContent = label;

    const valueEl = document.createElement("div");
    valueEl.className = "reward-field-value";
    valueEl.textContent = value;

    div.appendChild(labelEl);
    div.appendChild(valueEl);

    return div;
}

function createStatusBadge(status: number): HTMLElement {
    const div = document.createElement("div");
    div.className = "reward-field";

    const labelEl = document.createElement("div");
    labelEl.className = "reward-field-label";
    labelEl.textContent = t('rewards_field_status');

    const badge = document.createElement("span");
    badge.className = `reward-status status-${status}`;
    badge.textContent = getStatusText(status);

    div.appendChild(labelEl);
    div.appendChild(badge);

    return div;
}

function getStatusText(status: number): string {
    const statusMap: Record<number, string> = {
        0: t('rewards_status_pending'),
        10: t('rewards_status_locked'),
        20: t('rewards_status_success'),
        30: t('rewards_status_failed'),
        40: t('rewards_status_cancelled')
    };
    return statusMap[status] || t('rewards_status_unknown');
}

function formatDate(dateString: string): string {
    try {
        const date = new Date(dateString);
        return date.toLocaleString("zh-CN", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit"
        });
    } catch {
        return dateString;
    }
}

async function handleClaimReward(rewardId: number) {
    showLoading(t('rewards_claiming'));

    try {
        const cdpUserId = await queryCdpUserID();
        if (!cdpUserId) {
            showNotification(t('rewards_user_id_not_found'), "error");
            return;
        }

        const response = await x402WorkerFetch("/rewards/claim_item", {
            cdp_user_id: cdpUserId,
            id: rewardId
        });

        if (response.success && response.data) {
            const {txHash} = response.data;
            showNotification(t('rewards_claim_success'), "success");

            // 打开区块链浏览器
            const chainId = await getChainId();
            await browser.tabs.create({
                url: X402_FACILITATORS[chainId].browser + "/tx/" + txHash
            });

            // 刷新奖励列表
            currentPageStart = 0;
            await loadRewards();
        } else {
            showNotification(t('rewards_claim_failed') + ": " + (response.error || t('rewards_unknown_error')), "error");
        }
    } catch (error) {
        console.error("领取奖励失败:", error);
        showNotification(t('rewards_claim_failed') + ": " + (error as Error).message, "error");
    } finally {
        hideLoading();
    }
}
