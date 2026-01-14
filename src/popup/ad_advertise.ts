// ad_advertise.ts
// 用假数据驱动 Advertise 页面的界面和按钮交互
// ✅ 已移除所有 document.createElement：全部改为 HTML <template> + cloneNode

// ========= 类型定义 =========

import {$, $2, cloneTemplate, formatUSDC, showNotification} from "./common";

type AdStatus = "Active" | "Paused" | "Ended" | "Balance Low";

interface MyAdRow {
    id: string;
    name: string;
    status: AdStatus;
    rewardPerTask: number;
    completed: number;
    spent: number;
    remainingBudget: number;
}

interface SpendRecord {
    id: string;
    time: string;
    adName: string;
    event: string;
    amount: number;
    fee: number;
    status: "Success" | "Pending" | "Failed";
}

interface HistoryRow {
    time: string;
    adNameOrMethod: string;
    amount: number;
    status: string;
}

// ========= 假数据 =========

let fakeAdAccountBalanceUSDC = 80.0;

let myAds: MyAdRow[] = [
    {
        id: "my_ad_1",
        name: "Twitter Followers Campaign",
        status: "Active",
        rewardPerTask: 0.5,
        completed: 150,
        spent: 75,
        remainingBudget: 25
    },
    {
        id: "my_ad_2",
        name: "Landing Page Visit",
        status: "Paused",
        rewardPerTask: 0.2,
        completed: 300,
        spent: 60,
        remainingBudget: 10
    }
];

let spendRecords: SpendRecord[] = [
    {
        id: "sp_1",
        time: "2026-01-14 10:12",
        adName: "Twitter Followers Campaign",
        event: "Task completed",
        amount: 0.5,
        fee: 0.025,
        status: "Success"
    },
    {
        id: "sp_2",
        time: "2026-01-14 09:30",
        adName: "Landing Page Visit",
        event: "Task completed",
        amount: 0.2,
        fee: 0.01,
        status: "Success"
    }
];

const historyEarnings: HistoryRow[] = [
    {time: "2026-01-14 10:12", adNameOrMethod: "Twitter Followers Campaign", amount: 0.5, status: "Completed"},
    {time: "2026-01-14 09:30", adNameOrMethod: "Landing Page Visit", amount: 0.2, status: "Completed"}
];

const historySpending: HistoryRow[] = [
    {time: "2026-01-14 10:12", adNameOrMethod: "Twitter Followers Campaign", amount: -0.525, status: "Success"},
    {time: "2026-01-14 09:30", adNameOrMethod: "Landing Page Visit", amount: -0.21, status: "Success"}
];

const historyRecharge: HistoryRow[] = [
    {time: "2026-01-13 18:20", adNameOrMethod: "Onramp (Card)", amount: 100, status: "Success"}
];

const fakeWalletAddress = "0xDEMO1234567890abcdef1234567890ABCDEF0000";

// ========= 顶部余额 & Advertise 仪表盘 =========

function renderHeaderBalance() {
    const balanceSpan = document.querySelector<HTMLElement>(".balance-value");
    if (balanceSpan) balanceSpan.textContent = formatUSDC(fakeAdAccountBalanceUSDC);
}

function renderAdvertiseDashboard() {
    const cards = document.querySelectorAll<HTMLElement>("#view-advertise .dashboard-card");

    const card1Value = cards[0]?.querySelector<HTMLElement>(".card-value");
    if (card1Value) card1Value.textContent = formatUSDC(fakeAdAccountBalanceUSDC);

    const activeCount = myAds.filter((ad) => ad.status === "Active").length;
    const card2Value = cards[1]?.querySelector<HTMLElement>(".card-value");
    if (card2Value) card2Value.textContent = activeCount.toString();

    const todaySpend = spendRecords.reduce((sum, r) => sum + (r.amount + r.fee), 0);
    const card3Value = cards[2]?.querySelector<HTMLElement>(".card-value");
    if (card3Value) card3Value.textContent = formatUSDC(todaySpend);

    const weekSpend = todaySpend * 3;
    const card4Value = cards[3]?.querySelector<HTMLElement>(".card-value");
    if (card4Value) card4Value.textContent = formatUSDC(weekSpend);
}

// ========= My Ads 表格（模板 clone） =========

function renderMyAdsTable() {
    const tbody = document.querySelector<HTMLTableSectionElement>("#my-ads-tbody");
    if (!tbody) return;

    tbody.replaceChildren();

    if (myAds.length === 0) {
        tbody.appendChild(cloneTemplate("tpl-empty-my-ads-row") as any);
        return;
    }

    myAds.forEach((ad) => {
        const tr = cloneTemplate("tpl-my-ad-row") as HTMLTableRowElement;
        tr.dataset.adId = ad.id;

        $2<HTMLElement>(tr, ".td-name").textContent = ad.name;
        $2<HTMLElement>(tr, ".td-status").textContent = ad.status;
        $2<HTMLElement>(tr, ".td-reward").textContent = formatUSDC(ad.rewardPerTask);
        $2<HTMLElement>(tr, ".td-completed").textContent = ad.completed.toString();
        $2<HTMLElement>(tr, ".td-spent").textContent = formatUSDC(ad.spent);
        $2<HTMLElement>(tr, ".td-remaining").textContent = formatUSDC(ad.remainingBudget);

        const btnView = $2<HTMLButtonElement>(tr, ".btn-view");
        const btnToggle = $2<HTMLButtonElement>(tr, ".btn-toggle");

        btnView.addEventListener("click", () => showNotification(`View ad: ${ad.name}`));

        btnToggle.textContent = ad.status === "Active" ? "Pause" : "Resume";
        btnToggle.addEventListener("click", () => {
            ad.status = ad.status === "Active" ? "Paused" : "Active";
            renderMyAdsTable();
            renderAdvertiseDashboard();
        });

        tbody.appendChild(tr);
    });
}

// ========= Recent Spending 表格（模板 clone） =========

function renderSpendTable() {
    const tbody = document.querySelector<HTMLTableSectionElement>("#spending-tbody");
    if (!tbody) return;

    tbody.replaceChildren();

    if (spendRecords.length === 0) {
        tbody.appendChild(cloneTemplate("tpl-empty-spend-row") as any);
        return;
    }

    spendRecords.forEach((r) => {
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

// ========= 发布广告向导（Wizard） =========

let wizardCurrentStep = 1;
const wizardMaxStep = 4;

function openWizard() {
    wizardCurrentStep = 1;
    updateWizardUI();
    document.querySelector<HTMLElement>("#publish-wizard-modal")?.classList.add("active");
}

function closeWizard() {
    document.querySelector<HTMLElement>("#publish-wizard-modal")?.classList.remove("active");
}

function updateWizardUI() {
    const steps = document.querySelectorAll<HTMLElement>(".wizard-step");
    steps.forEach((stepEl) => {
        const step = Number(stepEl.dataset.step);
        stepEl.classList.toggle("active", step === wizardCurrentStep);
        stepEl.classList.toggle("completed", step < wizardCurrentStep);
    });

    const contents = document.querySelectorAll<HTMLElement>(".wizard-content");
    contents.forEach((c) => {
        const step = Number(c.dataset.step);
        c.classList.toggle("active", step === wizardCurrentStep);
    });

    const prevBtn = $("#btn-wizard-prev") as HTMLButtonElement;
    const nextBtn = $("#btn-wizard-next") as HTMLButtonElement;
    const submitBtn = $("#btn-wizard-submit") as HTMLButtonElement;

    prevBtn.style.display = wizardCurrentStep > 1 ? "inline-flex" : "none";
    if (wizardCurrentStep < wizardMaxStep) {
        nextBtn.style.display = "inline-flex";
        submitBtn.style.display = "none";
    } else {
        nextBtn.style.display = "none";
        submitBtn.style.display = "inline-flex";
        updateBudgetSummaryAndBalance();
    }
}

function goWizardNext() {
    if (wizardCurrentStep < wizardMaxStep) {
        wizardCurrentStep++;
        updateWizardUI();
    }
}

function goWizardPrev() {
    if (wizardCurrentStep > 1) {
        wizardCurrentStep--;
        updateWizardUI();
    }
}

function updateBudgetSummaryAndBalance() {
    const rewardInput = document.querySelector<HTMLInputElement>("#reward-amount");
    const taskLimitInput = document.querySelector<HTMLInputElement>("#task-limit");

    const reward = Number(rewardInput?.value || "0");
    const tasks = Number(taskLimitInput?.value || "0");

    const base = (Number.isFinite(reward) ? reward : 0) * (Number.isFinite(tasks) ? tasks : 0);
    const fee = base * 0.05;
    const total = base + fee;

    $("#summary-reward").textContent = formatUSDC(reward);
    $("#summary-tasks").textContent = Number.isFinite(tasks) ? tasks.toString() : "0";
    $("#summary-fee").textContent = formatUSDC(fee);
    $("#summary-total").textContent = formatUSDC(total);

    $("#current-balance").textContent = formatUSDC(fakeAdAccountBalanceUSDC);

    const balanceStatus = $("#balance-status");
    balanceStatus.className = "balance-status";

    if (total > 0 && total <= fakeAdAccountBalanceUSDC) {
        balanceStatus.classList.add("sufficient");
        balanceStatus.textContent = "Your balance is sufficient to publish this ad.";
    } else if (total > fakeAdAccountBalanceUSDC) {
        balanceStatus.classList.add("insufficient");
        balanceStatus.textContent = "Insufficient balance. Please recharge before publishing.";
    } else {
        balanceStatus.textContent = "";
    }
}

function submitWizard() {
    const nameInput = document.querySelector<HTMLInputElement>("#ad-name");
    const rewardInput = document.querySelector<HTMLInputElement>("#reward-amount");
    const taskLimitInput = document.querySelector<HTMLInputElement>("#task-limit");

    const name = nameInput?.value?.trim() || "Untitled Ad";
    const reward = Number(rewardInput?.value || "0");
    const tasks = Number(taskLimitInput?.value || "0");

    const base = reward * tasks;
    const fee = base * 0.05;
    const total = base + fee;

    if (total > fakeAdAccountBalanceUSDC) {
        showNotification("Insufficient ad account balance (fake check).");
        return;
    }

    const newAd: MyAdRow = {
        id: "my_ad_" + (myAds.length + 1),
        name,
        status: "Active",
        rewardPerTask: reward || 0,
        completed: 0,
        spent: 0,
        remainingBudget: total
    };

    myAds.unshift(newAd);
    fakeAdAccountBalanceUSDC -= total * 0.1; // 演示：随便扣一点

    renderMyAdsTable();
    renderAdvertiseDashboard();
    renderHeaderBalance();

    closeWizard();
    showNotification("Ad published (fake).");
}

// ========= 充值弹窗 =========

function openRechargeModal() {
    const modal = document.querySelector<HTMLElement>("#recharge-modal");
    const addrEl = document.querySelector<HTMLElement>("#wallet-address-display");
    if (addrEl) addrEl.textContent = fakeWalletAddress;
    modal?.classList.add("active");
}

function closeRechargeModal() {
    document.querySelector<HTMLElement>("#recharge-modal")?.classList.remove("active");
}

function initRechargeModalEvents() {
    document.querySelector<HTMLButtonElement>("#btn-recharge")?.addEventListener("click", openRechargeModal);
    document.querySelector<HTMLButtonElement>("#btn-recharge-dashboard")?.addEventListener("click", openRechargeModal);
    document.querySelector<HTMLButtonElement>("#close-recharge")?.addEventListener("click", closeRechargeModal);

    document.querySelector<HTMLButtonElement>("#copy-address")?.addEventListener("click", async () => {
        try {
            if (navigator.clipboard) {
                await navigator.clipboard.writeText(fakeWalletAddress);
                showNotification("Address copied (fake).");
            } else {
                showNotification(fakeWalletAddress);
            }
        } catch {
            showNotification(fakeWalletAddress);
        }
    });

    document.querySelector<HTMLButtonElement>("#btn-buy-card")?.addEventListener("click", () => {
        showNotification("Open onramp (fake).");
    });
}

// ========= 历史记录弹窗（模板 clone） =========

function openHistoryModal(defaultTab: "earnings" | "spending" | "recharge" = "spending") {
    document.querySelector<HTMLElement>("#history-modal")?.classList.add("active");
    switchHistoryTab(defaultTab);
}

function closeHistoryModal() {
    document.querySelector<HTMLElement>("#history-modal")?.classList.remove("active");
}

function renderHistoryTable(tab: "earnings" | "spending" | "recharge", rows: HistoryRow[]) {
    const tbody = document.querySelector<HTMLTableSectionElement>(
        `.history-tab-content[data-tab="${tab}"] tbody`
    );
    if (!tbody) return;

    tbody.replaceChildren();

    if (rows.length === 0) {
        const tr = cloneTemplate("tpl-empty-history-row") as HTMLTableRowElement;
        const msg =
            tab === "earnings" ? "No earnings yet" :
                tab === "spending" ? "No spending yet" :
                    "No recharge records";
        $2<HTMLElement>(tr, ".td-empty").textContent = msg;
        tbody.appendChild(tr);
        return;
    }

    rows.forEach((row) => {
        const tr = cloneTemplate("tpl-history-row") as HTMLTableRowElement;
        $2<HTMLElement>(tr, ".td-time").textContent = row.time;
        $2<HTMLElement>(tr, ".td-name").textContent = row.adNameOrMethod;
        $2<HTMLElement>(tr, ".td-amount").textContent = formatUSDC(row.amount);
        $2<HTMLElement>(tr, ".td-status").textContent = row.status;
        tbody.appendChild(tr);
    });
}

function switchHistoryTab(tab: "earnings" | "spending" | "recharge") {
    document.querySelectorAll<HTMLButtonElement>(".history-tab").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.tab === tab);
    });

    document.querySelectorAll<HTMLElement>(".history-tab-content").forEach((c) => {
        c.classList.toggle("active", c.dataset.tab === tab);
    });

    if (tab === "earnings") renderHistoryTable("earnings", historyEarnings);
    if (tab === "spending") renderHistoryTable("spending", historySpending);
    if (tab === "recharge") renderHistoryTable("recharge", historyRecharge);
}

function initHistoryModalEvents() {
    document.querySelector<HTMLButtonElement>("#btn-history")?.addEventListener("click", () => openHistoryModal("spending"));
    document.querySelector<HTMLButtonElement>("#close-history")?.addEventListener("click", closeHistoryModal);

    document.querySelectorAll<HTMLButtonElement>(".history-tab").forEach((btn) => {
        btn.addEventListener("click", () => {
            const tab = (btn.dataset.tab || "spending") as any;
            switchHistoryTab(tab);
        });
    });
}

// ========= 事件绑定：Wizard =========

function initWizardEvents() {
    document.querySelector<HTMLButtonElement>("#btn-publish-ad")?.addEventListener("click", openWizard);
    document.querySelector<HTMLButtonElement>("#close-wizard")?.addEventListener("click", closeWizard);
    document.querySelector<HTMLButtonElement>("#btn-wizard-prev")?.addEventListener("click", goWizardPrev);
    document.querySelector<HTMLButtonElement>("#btn-wizard-next")?.addEventListener("click", goWizardNext);
    document.querySelector<HTMLButtonElement>("#btn-wizard-submit")?.addEventListener("click", submitWizard);

    document.querySelector<HTMLInputElement>("#reward-amount")?.addEventListener("input", updateBudgetSummaryAndBalance);
    document.querySelector<HTMLInputElement>("#task-limit")?.addEventListener("input", updateBudgetSummaryAndBalance);
}

// ========= 初始化入口 =========

function initAdvertise() {
    renderHeaderBalance();
    renderAdvertiseDashboard();
    renderMyAdsTable();
    renderSpendTable();

    initWizardEvents();
    initRechargeModalEvents();
    initHistoryModalEvents();
}

document.addEventListener("DOMContentLoaded", () => {
    try {
        initAdvertise();
    } catch (err) {
        console.error("Advertise init error:", err);
    }
});
