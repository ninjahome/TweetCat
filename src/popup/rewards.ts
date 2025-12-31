import browser from "webextension-polyfill";
import {queryCdpUserID} from "../wallet/cdp_wallet";
import {showLoading, hideLoading, showNotification, x402WorkerFetch, x402WorkerGet} from "./common";
import {getChainId} from "../wallet/wallet_setting";
import {X402_FACILITATORS} from "../common/x402_obj";

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

document.addEventListener("DOMContentLoaded", initRewardsPage);

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
    showLoading("加载中...");
    
    try {
        const cdpUserId = await queryCdpUserID();
        if (!cdpUserId) {
            showNotification("未找到用户ID", "error");
            return;
        }
        
        const response: HistoryResponse = await x402WorkerGet("/rewards/query_history", {
            cdp_user_id: cdpUserId,
            status: currentStatus.toString(),
            page_start: currentPageStart.toString()
        });
        
        if (response.success && response.data) {
            const { rewards, hasMore } = response.data;
            hasMorePages = hasMore;
            
            // 更新分页按钮状态
            updatePaginationButtons();
            
            // 渲染奖励列表
            renderRewardsList(rewards);
        }
    } catch (error) {
        console.error("加载奖励失败:", error);
        showNotification("加载奖励失败: " + (error as Error).message, "error");
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
        pageInfo.textContent = `第 ${currentPage} 页`;
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
    const idField = createField("ID", reward.id.toString());
    basicInfo.appendChild(idField);
    
    // 资产
    const assetField = createField("资产", reward.asset_symbol);
    basicInfo.appendChild(assetField);
    
    // 金额
    const amount = Number(reward.amount_atomic) / 1e6;
    const amountField = createField("金额", amount.toFixed(6));
    amountField.querySelector(".reward-field-value")?.classList.add("reward-amount");
    basicInfo.appendChild(amountField);
    
    // 状态
    const statusField = createStatusBadge(reward.status);
    basicInfo.appendChild(statusField);
    
    // 创建时间
    const createdAtField = createField("创建时间", formatDate(reward.created_at));
    basicInfo.appendChild(createdAtField);
    
    collapsedContent.appendChild(basicInfo);
    div.appendChild(collapsedContent);
    
    // 展开状态内容
    const expandedContent = document.createElement("div");
    expandedContent.className = "reward-expanded";
    
    const detailGrid = document.createElement("div");
    detailGrid.className = "reward-detail-grid";
    
    // 更新时间
    const updatedAtField = createField("更新时间", formatDate(reward.updated_at));
    detailGrid.appendChild(updatedAtField);
    
    // 原因
    if (reward.reason) {
        const reasonField = createField("原因", reward.reason);
        detailGrid.appendChild(reasonField);
    }
    
    // 交易哈希
    if (reward.tx_hash) {
        const txField = createField("交易哈希", reward.tx_hash.substring(0, 16) + "...");
        detailGrid.appendChild(txField);
    }
    
    // 资产地址
    if (reward.asset_address) {
        const addressField = createField("资产地址", reward.asset_address.substring(0, 16) + "...");
        detailGrid.appendChild(addressField);
    }
    
    expandedContent.appendChild(detailGrid);
    
    // 操作按钮
    if (reward.status === 0) {
        const actions = document.createElement("div");
        actions.className = "reward-actions";
        
        const claimBtn = document.createElement("button");
        claimBtn.className = "btn-claim";
        claimBtn.textContent = "领取";
        claimBtn.onclick = (e) => {
            e.stopPropagation();
            handleClaimReward(reward.id);
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
        viewTxBtn.textContent = "查看交易";
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
    labelEl.textContent = "状态";
    
    const badge = document.createElement("span");
    badge.className = `reward-status status-${status}`;
    badge.textContent = getStatusText(status);
    
    div.appendChild(labelEl);
    div.appendChild(badge);
    
    return div;
}

function getStatusText(status: number): string {
    const statusMap: Record<number, string> = {
        0: "待领取",
        10: "锁定中",
        20: "成功",
        30: "失败",
        40: "已取消"
    };
    return statusMap[status] || "未知";
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
    showLoading("正在领取奖励...");
    
    try {
        const cdpUserId = await queryCdpUserID();
        if (!cdpUserId) {
            showNotification("未找到用户ID", "error");
            return;
        }
        
        const response = await x402WorkerFetch("/rewards/claim_item", {
            cdp_user_id: cdpUserId,
            id: rewardId
        });
        
        if (response.success && response.data) {
            const { txHash } = response.data;
            showNotification("领取成功!", "success");
            
            // 打开区块链浏览器
            const chainId = await getChainId();
            await browser.tabs.create({
                url: X402_FACILITATORS[chainId].browser + "/tx/" + txHash
            });
            
            // 刷新奖励列表
            currentPageStart = 0;
            await loadRewards();
        } else {
            showNotification("领取失败: " + (response.error || "未知错误"), "error");
        }
    } catch (error) {
        console.error("领取奖励失败:", error);
        showNotification("领取奖励失败: " + (error as Error).message, "error");
    } finally {
        hideLoading();
    }
}
