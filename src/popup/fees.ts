import browser from "webextension-polyfill";
import {queryCdpUserID} from "../wallet/cdp_wallet";
import {showLoading, hideLoading, showNotification, x402WorkerGet} from "./common";
import {getChainId} from "../wallet/wallet_setting";
import {X402_FACILITATORS} from "../common/x402_obj";
import {initI18n, t} from "../common/i18n";

interface PlatformFee {
    id: number;
    reward_id: number;
    cdp_user_id: string;
    gross_amount: string;
    fee_rate: number;
    fee_amount: string;
    net_amount: string;
    tx_hash: string | null;
    user_wallet_address: string | null;
    platform_wallet_address: string | null;
    created_at: string;
    updated_at: string;
}

interface FeesHistoryResponse {
    success: boolean;
    data: {
        fees: PlatformFee[];
        hasMore: boolean;
        pageStart: number;
        pageSize: number;
    };
}

let currentPageStart = 0;
let hasMorePages = false;
let currentFee: PlatformFee | null = null;
let allFees: PlatformFee[] = [];

document.addEventListener("DOMContentLoaded", () => {
    initI18n();
    initFeesTexts();
    initFeesPage().then();
});

function initFeesTexts() {
    // 页面标题
    document.title = t('fees_page_title') || 'Fee History';
    const pageTitle = document.getElementById('fees-page-title');
    if (pageTitle) {
        pageTitle.textContent = t('fees_page_title') || 'Fee History';
    }

    // 统计标签
    const labelTotalFees = document.getElementById('label-total-fees');
    if (labelTotalFees) {
        labelTotalFees.textContent = t('fees_total_paid') || 'Total Fees Paid';
    }

    const labelAvgRate = document.getElementById('label-avg-fee-rate');
    if (labelAvgRate) {
        labelAvgRate.textContent = t('fees_avg_rate') || 'Average Fee Rate';
    }

    const labelTotalCount = document.getElementById('label-total-count');
    if (labelTotalCount) {
        labelTotalCount.textContent = t('fees_total_count') || 'Total Transactions';
    }

    // 分页按钮
    const prevBtn = document.getElementById('prev-page');
    if (prevBtn) {
        prevBtn.textContent = t('fees_prev_page') || 'Previous';
    }

    const nextBtn = document.getElementById('next-page');
    if (nextBtn) {
        nextBtn.textContent = t('fees_next_page') || 'Next';
    }

    // 空状态
    const emptyStateText = document.getElementById('empty-state-text');
    if (emptyStateText) {
        emptyStateText.textContent = t('fees_empty_state') || 'No fee records yet';
    }

    // 详情标签
    const modalTitle = document.getElementById('modal-title');
    if (modalTitle) {
        modalTitle.textContent = t('fees_detail_title') || 'Fee Details';
    }

    const viewOnChainBtn = document.getElementById('view-on-chain');
    if (viewOnChainBtn) {
        viewOnChainBtn.textContent = t('fees_view_on_chain') || 'View on Blockchain';
    }
}

async function initFeesPage() {
    // 返回按钮
    const backBtn = document.getElementById("fees-back-btn");
    if (backBtn) {
        backBtn.addEventListener("click", () => {
            window.history.back();
        });
    }

    // 分页按钮
    const prevBtn = document.getElementById("prev-page") as HTMLButtonElement;
    const nextBtn = document.getElementById("next-page") as HTMLButtonElement;

    if (prevBtn) {
        prevBtn.addEventListener("click", handlePrevPage);
    }

    if (nextBtn) {
        nextBtn.addEventListener("click", handleNextPage);
    }

    // 弹窗关闭
    const closeModal = document.getElementById("close-fee-detail");
    if (closeModal) {
        closeModal.addEventListener("click", () => {
            const modal = document.getElementById("fee-detail-modal");
            if (modal) {
                modal.classList.add("hidden");
            }
        });
    }

    // 点击弹窗外部关闭
    const modal = document.getElementById("fee-detail-modal");
    if (modal) {
        modal.addEventListener("click", (e) => {
            if (e.target === modal) {
                modal.classList.add("hidden");
            }
        });
    }

    // 查看链上交易
    const viewOnChain = document.getElementById("view-on-chain");
    if (viewOnChain) {
        viewOnChain.addEventListener("click", async () => {
            if (currentFee && currentFee.tx_hash) {
                const chainId = await getChainId();
                await browser.tabs.create({
                    url: X402_FACILITATORS[chainId].browser + "/tx/" + currentFee.tx_hash
                });
            }
        });
    }

    // 加载数据
    await loadFees();
}

async function handlePrevPage() {
    if (currentPageStart > 0) {
        currentPageStart = Math.max(0, currentPageStart - 20);
        await loadFees();
    }
}

async function handleNextPage() {
    if (hasMorePages) {
        currentPageStart += 20;
        await loadFees();
    }
}

async function loadFees() {
    showLoading(t('fees_loading') || "Loading fee history...");

    try {
        const cdpUserId = await queryCdpUserID();
        if (!cdpUserId) {
            showNotification(t('fees_user_id_not_found') || "User ID not found", "error");
            return;
        }

        const response: FeesHistoryResponse = await x402WorkerGet("/fees/query_history", {
            cdp_user_id: cdpUserId,
            page_start: currentPageStart.toString()
        });

        if (response.success && response.data) {
            const {fees, hasMore} = response.data;
            hasMorePages = hasMore;
            allFees = fees;

            // 更新统计
            updateSummary(fees);

            // 更新分页按钮
            updatePaginationButtons();

            console.log("--------->>> fees data:", fees)
            // 渲染列表
            renderFeesList(fees);
        }
    } catch (error) {
        console.error("Load fees failed:", error);
        showNotification(
            (t('fees_load_failed') || "Failed to load fee history") + ": " + (error as Error).message,
            "error"
        );
    } finally {
        hideLoading();
    }
}

function updateSummary(fees: PlatformFee[]) {
    // 计算当前页的统计数据
    const totalFee = fees.reduce((sum, fee) => sum + Number(fee.fee_amount), 0) / 1e6;
    const avgRate = fees.length > 0
        ? fees.reduce((sum, fee) => sum + fee.fee_rate, 0) / fees.length
        : 0;

    const totalFeesEl = document.getElementById("total-fees");
    const avgFeeRateEl = document.getElementById("avg-fee-rate");
    const totalCountEl = document.getElementById("total-count");

    if (totalFeesEl) {
        totalFeesEl.textContent = totalFee.toFixed(2) + " USDC";
    }

    if (avgFeeRateEl) {
        avgFeeRateEl.textContent = avgRate.toFixed(1) + "%";
    }

    if (totalCountEl) {
        totalCountEl.textContent = fees.length.toString();
    }
}

function updatePaginationButtons() {
    const prevBtn = document.getElementById("prev-page") as HTMLButtonElement;
    const nextBtn = document.getElementById("next-page") as HTMLButtonElement;
    const pageInfo = document.getElementById("page-info");

    if (prevBtn) {
        prevBtn.disabled = currentPageStart === 0;
    }

    if (nextBtn) {
        nextBtn.disabled = !hasMorePages;
    }

    if (pageInfo) {
        const currentPage = Math.floor(currentPageStart / 20) + 1;
        pageInfo.textContent = `${t('fees_page') || 'Page'} ${currentPage}`;
    }
}

function renderFeesList(fees: PlatformFee[]) {
    const listContainer = document.getElementById("fees-list");
    const emptyState = document.getElementById("empty-state");

    if (!listContainer) return;

    listContainer.innerHTML = "";

    if (fees.length === 0) {
        listContainer.style.display = "none";
        if (emptyState) {
            emptyState.style.display = "block";
        }
        return;
    }

    listContainer.style.display = "flex";
    if (emptyState) {
        emptyState.style.display = "none";
    }

    fees.forEach(fee => {
        const feeItem = createFeeItem(fee);
        listContainer.appendChild(feeItem);
    });
}

function createFeeItem(fee: PlatformFee): HTMLElement {
    const div = document.createElement("div");
    div.className = "fee-item";

    // 头部
    const header = document.createElement("div");
    header.className = "fee-item-header";

    const idLabel = document.createElement("div");
    idLabel.className = "fee-item-id";
    idLabel.textContent = `${t('fees_reward_id') || 'Reward'} #${fee.reward_id}`;

    const badge = document.createElement("span");
    badge.className = "fee-badge";
    badge.textContent = `${fee.fee_rate}% ${t('fees_fee_badge') || 'Fee'}`;

    header.appendChild(idLabel);
    header.appendChild(badge);
    div.appendChild(header);

    // 内容网格
    const grid = document.createElement("div");
    grid.className = "fee-item-grid";

    // Gross Amount
    const grossField = createField(
        t('fees_field_gross') || "Gross",
        (Number(fee.gross_amount) / 1e6).toFixed(2) + " USDC"
    );
    grid.appendChild(grossField);

    // Fee Amount
    const feeField = createField(
        t('fees_field_fee') || "Fee",
        (Number(fee.fee_amount) / 1e6).toFixed(2) + " USDC"
    );
    feeField.querySelector(".fee-field-value")?.classList.add("fee-highlight");
    grid.appendChild(feeField);

    // Net Amount
    const netField = createField(
        t('fees_field_net') || "Net",
        (Number(fee.net_amount) / 1e6).toFixed(2) + " USDC"
    );
    netField.querySelector(".fee-field-value")?.classList.add("success-text");
    grid.appendChild(netField);

    // Created At
    const createdField = createField(
        t('fees_field_date') || "Date",
        formatDate(fee.created_at)
    );
    grid.appendChild(createdField);

    div.appendChild(grid);

    // 点击显示详情
    div.onclick = () => {
        showFeeDetail(fee);
    };

    return div;
}

function createField(label: string, value: string): HTMLElement {
    const div = document.createElement("div");
    div.className = "fee-field";

    const labelEl = document.createElement("div");
    labelEl.className = "fee-field-label";
    labelEl.textContent = label;

    const valueEl = document.createElement("div");
    valueEl.className = "fee-field-value";
    valueEl.textContent = value;

    div.appendChild(labelEl);
    div.appendChild(valueEl);

    return div;
}

function showFeeDetail(fee: PlatformFee) {
    currentFee = fee;

    // 填充详情
    const detailGross = document.getElementById("detail-gross");
    const detailRate = document.getElementById("detail-rate");
    const detailFee = document.getElementById("detail-fee");
    const detailNet = document.getElementById("detail-net");
    const detailTx = document.getElementById("detail-tx");
    const detailUserWallet = document.getElementById("detail-user-wallet");
    const detailPlatformWallet = document.getElementById("detail-platform-wallet");
    const detailCreated = document.getElementById("detail-created");

    if (detailGross) {
        detailGross.textContent = (Number(fee.gross_amount) / 1e6).toFixed(6) + " USDC";
    }

    if (detailRate) {
        detailRate.textContent = fee.fee_rate + "%";
    }

    if (detailFee) {
        detailFee.textContent = (Number(fee.fee_amount) / 1e6).toFixed(6) + " USDC";
    }

    if (detailNet) {
        detailNet.textContent = (Number(fee.net_amount) / 1e6).toFixed(6) + " USDC";
    }

    if (detailTx && fee.tx_hash) {
        detailTx.textContent = fee.tx_hash;
    } else if (detailTx) {
        detailTx.textContent = "--";
    }

    if (detailUserWallet && fee.user_wallet_address) {
        detailUserWallet.textContent = fee.user_wallet_address;
    } else if (detailUserWallet) {
        detailUserWallet.textContent = "--";
    }

    if (detailPlatformWallet && fee.platform_wallet_address) {
        detailPlatformWallet.textContent = fee.platform_wallet_address;
    } else if (detailPlatformWallet) {
        detailPlatformWallet.textContent = "--";
    }

    if (detailCreated) {
        detailCreated.textContent = formatDate(fee.created_at);
    }

    // 显示弹窗
    const modal = document.getElementById("fee-detail-modal");
    if (modal) {
        modal.classList.remove("hidden");
    }
}

function formatDate(dateString: string): string {
    try {
        const date = new Date(dateString);
        return date.toLocaleString("en-US", {
            year: "numeric",
            month: "short",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit"
        });
    } catch {
        return dateString;
    }
}
