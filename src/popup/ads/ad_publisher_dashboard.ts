import {
    $Id,
    $2,
    atomicToUsdcNumber,
    cloneTemplate,
    formatUSDC,
    multiplyAtomic,
    showNotification,
    usdcToAtomic
} from "../common";
import {logAdP} from "../../common/debug_flags";
import {
    fetchAdEscrowLedger,
    fetchAdsBalance,
    fetchMyAds,
    openTxInExplorer,
    publisherState,
    updateAd
} from "./ad_publisher_common";
import type {AdRecord, AdStatus, HistoryRow} from "./ad_publisher_common";
import {getCurrentXId} from "./ad_publisher_common";

// ========= 数据刷新 =========
export async function refreshAdsData() {
    const currentXId = getCurrentXId();
    const [balance, ads] = await Promise.all([
        fetchAdsBalance(currentXId),
        fetchMyAds(currentXId),
    ]);

    publisherState.adAccountInfo = {
        balanceAtomic: balance?.balance_atomic ?? "0",
        frozenAtomic: balance?.frozen_atomic ?? "0",
    };
    publisherState.myAds = Array.isArray(ads) ? ads : [];

    logAdP("------>>> balance:", balance, " my ads:", publisherState.myAds);

    renderHeaderBalance();
    renderAdvertiseDashboard();
    renderMyAdsTable();
    updateBudgetSummaryAndBalance();
}

// ========= 顶部余额 & Advertise 仪表盘 =========
export function renderHeaderBalance() {
    const availableEl = $Id("ad-account-balance-value");
    if (availableEl) availableEl.textContent = formatUSDC(atomicToUsdcNumber(publisherState.adAccountInfo.balanceAtomic));

    const frozenEl = $Id("ad-account-frozen-value");
    if (frozenEl) frozenEl.textContent = formatUSDC(atomicToUsdcNumber(publisherState.adAccountInfo.frozenAtomic ?? "0"));
}

export function renderAdvertiseDashboard() {
    const cards = Array.from(document.querySelectorAll<HTMLElement>("#view-advertise .dashboard-card"));

    const card1Value = cards[0] ? $2<HTMLElement>(cards[0], ".card-value") : null;
    if (card1Value) card1Value.textContent = formatUSDC(atomicToUsdcNumber(publisherState.adAccountInfo.balanceAtomic));

    const activeCount = publisherState.myAds.filter((ad) => ad.status === "ACTIVE").length;
    const card2Value = cards[1] ? $2<HTMLElement>(cards[1], ".card-value") : null;
    if (card2Value) card2Value.textContent = activeCount.toString();

    const todaySpend = publisherState.myAds.reduce((sum, ad) => {
        const spent = atomicToUsdcNumber(multiplyAtomic(ad.unit_price_atomic, ad.quota_used));
        return sum + spent;
    }, 0);
    const card3Value = cards[2] ? $2<HTMLElement>(cards[2], ".card-value") : null;
    if (card3Value) card3Value.textContent = formatUSDC(todaySpend);

    const weekSpend = todaySpend;
    const card4Value = cards[3] ? $2<HTMLElement>(cards[3], ".card-value") : null;
    if (card4Value) card4Value.textContent = formatUSDC(weekSpend);
}

// ========= My Ads 表格 =========
interface MyAdRow {
    id: string;
    name: string;
    status: AdStatus;
    rewardPerTask: number;
    completed: number;
    spent: number;
    remainingBudget: number;
}

function mapStatus(status: string): AdStatus {
    if (status === "ACTIVE") return "Active";
    if (status === "PAUSED") return "Paused";
    return "Ended";
}

function buildMyAdRow(ad: AdRecord): MyAdRow {
    const rewardPerTask = atomicToUsdcNumber(ad.unit_price_atomic);
    const completed = Number.isFinite(ad.quota_used) ? ad.quota_used : 0;
    const quotaTotal = Number.isFinite(ad.quota_total) ? ad.quota_total : 0;

    const spentAtomic = multiplyAtomic(ad.unit_price_atomic, completed);
    const remainingAtomic = multiplyAtomic(ad.unit_price_atomic, Math.max(quotaTotal - completed, 0));

    return {
        id: ad.ad_id,
        name: ad.name,
        status: mapStatus(ad.status),
        rewardPerTask,
        completed,
        spent: atomicToUsdcNumber(spentAtomic),
        remainingBudget: atomicToUsdcNumber(remainingAtomic),
    };
}

export function renderMyAdsTable() {
    const tbody = document.querySelector<HTMLTableSectionElement>("#my-ads-tbody");
    if (!tbody) return;

    tbody.replaceChildren();

    if (publisherState.myAds.length === 0) {
        tbody.appendChild(cloneTemplate("tpl-empty-my-ads-row") as any);
        return;
    }

    publisherState.myAds.forEach((ad) => {
        const rowData = buildMyAdRow(ad);
        const tr = cloneTemplate("tpl-my-ad-row") as HTMLTableRowElement;
        tr.dataset.adId = rowData.id;

        $2<HTMLElement>(tr, ".td-name").textContent = rowData.name;
        $2<HTMLElement>(tr, ".td-status").textContent = rowData.status;
        $2<HTMLElement>(tr, ".td-reward").textContent = formatUSDC(rowData.rewardPerTask);
        $2<HTMLElement>(tr, ".td-completed").textContent = rowData.completed.toString();
        $2<HTMLElement>(tr, ".td-spent").textContent = formatUSDC(rowData.spent);
        $2<HTMLElement>(tr, ".td-remaining").textContent = formatUSDC(rowData.remainingBudget);

        const btnView = $2<HTMLButtonElement>(tr, ".btn-view");
        const btnToggle = $2<HTMLButtonElement>(tr, ".btn-toggle");

        btnView.addEventListener("click", () => openAdDetailModal(ad));

        btnToggle.textContent = "N/A";
        btnToggle.disabled = true;

        tbody.appendChild(tr);
    });
}

// ========= Ad Detail Modal =========
function openAdDetailModal(ad: AdRecord) {
    const modal = $Id("ad-detail-modal");
    if (!modal) return;

    // Populate Read-only fields
    const setText = (id: string, text: string) => {
        const el = $Id(id);
        if (el) el.textContent = text;
    };

    setText("detail-name", ad.name);
    setText("detail-status", mapStatus(ad.status));
    setText("detail-category", ad.category);
    setText("detail-created", ad.created_at ? new Date(ad.created_at).toLocaleString() : "-");
    setText("detail-title", ad.title);
    setText("detail-description", ad.description);
    
    const rewardUSDC = atomicToUsdcNumber(ad.unit_price_atomic);
    setText("detail-reward", formatUSDC(rewardUSDC));
    setText("detail-quota", ad.quota_total.toString());
    setText("detail-duration", ad.duration_days > 0 ? `${ad.duration_days} days` : "Unlimited");

    const linkEl = $Id("detail-url") as HTMLAnchorElement | null;
    if (linkEl) {
        linkEl.href = ad.detail_url;
        linkEl.textContent = ad.detail_url;
    }

    const imgContainer = $Id("detail-image-container");
    const imgEl = $Id("detail-image") as HTMLImageElement | null;
    if (imgContainer && imgEl) {
        if (ad.image_url) {
            imgEl.src = ad.image_url;
            imgContainer.style.display = "block";
        } else {
            imgContainer.style.display = "none";
        }
    }

    // Populate Editable fields
    const callbackInput = $Id("detail-callback-url") as HTMLInputElement | null;
    if (callbackInput) callbackInput.value = ad.callback_url || "";

    const customDataInput = $Id("detail-custom-data") as HTMLTextAreaElement | null;
    if (customDataInput) customDataInput.value = ad.custom_data || "";

    // Bind Update Button
    const btnUpdate = $Id("btn-update-ad-settings");
    if (btnUpdate) {
        // Remove old listeners to prevent duplicates (cloning button is safer but simple replacement works here)
        const newBtn = btnUpdate.cloneNode(true);
        btnUpdate.parentNode?.replaceChild(newBtn, btnUpdate);
        
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
                const payload = {
                    ad_id: ad.ad_id,
                    a_x_id: getCurrentXId(),
                    callback_url: newCallback,
                    custom_data: newCustomData,
                };

                const result = await updateAd(payload);

                if (result.ok) {
                    showNotification("Ad settings updated successfully!", "success");
                    // Optionally, refresh data
                    await refreshAdsData();
                    modal.classList.remove("active");
                } else {
                    const errorMsg = result.error?.detail || "Failed to update ad";
                    showNotification(errorMsg, "error");
                }
            } catch (err: any) {
                showNotification(err.message, "error");
            }
        });
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

    if (publisherState.spendRecords.length === 0) {
        tbody.appendChild(cloneTemplate("tpl-empty-spend-row") as any);
        return;
    }

    publisherState.spendRecords.forEach((r) => {
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
    if (currentBalance) currentBalance.textContent = formatUSDC(atomicToUsdcNumber(publisherState.adAccountInfo.balanceAtomic));

    const balanceStatus = $Id("balance-status");
    if (balanceStatus) {
        balanceStatus.className = "balance-status";

        if (requiredAtomic && BigInt(requiredAtomic) > 0n && BigInt(publisherState.adAccountInfo.balanceAtomic) >= BigInt(requiredAtomic)) {
            balanceStatus.classList.add("sufficient");
            balanceStatus.textContent = "Your balance is sufficient to publish this ad.";
        } else if (requiredAtomic && BigInt(requiredAtomic) > 0n && BigInt(publisherState.adAccountInfo.balanceAtomic) < BigInt(requiredAtomic)) {
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

        return {time, adNameOrMethod, amount, status, txHash: row.tx_hash || null};
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
