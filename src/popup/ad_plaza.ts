// ad_plaza.ts
// 用假数据驱动 Ad Plaza 的所有界面和按钮交互
// ✅ 已移除所有 document.createElement：全部改为 HTML <template> + cloneNode

// ========= 类型定义 =========

type AdCategory = "follow" | "visit" | "register" | "share";

interface EarnAd {
    id: string;
    title: string;
    brand: string;
    description: string;
    category: AdCategory;
    rewardUSDC: number;
    durationMinutes: number;
    completed: number;
    totalQuota: number;
    deadlineText: string;
    tags: string[];
    rewardRange: "0.1-0.5" | "0.5-1" | "1+";
    popularityScore: number;
    createdAt: number; // 时间戳，方便排序
    detailUrl: string;
}

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

const fakeEarnAds: EarnAd[] = [
    {
        id: "ad_1",
        title: "Follow Our DeFi Twitter",
        brand: "@OpenDeFiLab",
        description: "Follow our official Twitter account to get the latest alpha and earn instant rewards.",
        category: "follow",
        rewardUSDC: 0.5,
        durationMinutes: 2,
        completed: 128,
        totalQuota: 500,
        deadlineText: "Ends: Jan 31",
        tags: ["New", "Easy"],
        rewardRange: "0.5-1",
        popularityScore: 90,
        createdAt: Date.now() - 1000 * 60 * 60 * 6,
        detailUrl: "https://example.com/ad/1"
    },
    {
        id: "ad_2",
        title: "Visit NFT Marketplace",
        brand: "@NFTUniverse",
        description: "Visit our brand new NFT marketplace and explore trending collections.",
        category: "visit",
        rewardUSDC: 0.2,
        durationMinutes: 3,
        completed: 320,
        totalQuota: 1000,
        deadlineText: "Ends: Feb 2",
        tags: ["Popular"],
        rewardRange: "0.1-0.5",
        popularityScore: 75,
        createdAt: Date.now() - 1000 * 60 * 60 * 24,
        detailUrl: "https://example.com/ad/2"
    },
    {
        id: "ad_3",
        title: "Register New Web3 Wallet",
        brand: "@WalletX",
        description: "Create a new Web3 wallet in 2 minutes and get rewarded.",
        category: "register",
        rewardUSDC: 1.2,
        durationMinutes: 5,
        completed: 45,
        totalQuota: 200,
        deadlineText: "Ends: Feb 10",
        tags: ["High Reward"],
        rewardRange: "1+",
        popularityScore: 60,
        createdAt: Date.now() - 1000 * 60 * 30,
        detailUrl: "https://example.com/ad/3"
    },
    {
        id: "ad_4",
        title: "Share Our Trading Bot",
        brand: "@TradeBotPro",
        description: "Share our trading bot tweet to your followers and earn rewards.",
        category: "share",
        rewardUSDC: 0.8,
        durationMinutes: 4,
        completed: 200,
        totalQuota: 400,
        deadlineText: "Ends: Jan 28",
        tags: ["Easy", "Popular"],
        rewardRange: "0.5-1",
        popularityScore: 85,
        createdAt: Date.now() - 1000 * 60 * 60 * 2,
        detailUrl: "https://example.com/ad/4"
    }
];

let fakeUserBalanceUSDC = 123.45;     // 顶部 Balance
let fakeAdAccountBalanceUSDC = 80.0;  // Advertise 仪表盘里的 Ad Account Balance

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
    { time: "2026-01-14 10:12", adNameOrMethod: "Twitter Followers Campaign", amount: 0.5, status: "Completed" },
    { time: "2026-01-14 09:30", adNameOrMethod: "Landing Page Visit", amount: 0.2, status: "Completed" }
];

const historySpending: HistoryRow[] = [
    { time: "2026-01-14 10:12", adNameOrMethod: "Twitter Followers Campaign", amount: -0.525, status: "Success" },
    { time: "2026-01-14 09:30", adNameOrMethod: "Landing Page Visit", amount: -0.21, status: "Success" }
];

const historyRecharge: HistoryRow[] = [
    { time: "2026-01-13 18:20", adNameOrMethod: "Onramp (Card)", amount: 100, status: "Success" }
];

const fakeWalletAddress = "0xDEMO1234567890abcdef1234567890ABCDEF0000";

// ========= 工具函数 =========

function $(selector: string): HTMLElement {
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) throw new Error(`Element not found: ${selector}`);
    return el;
}

function q<T extends Element>(root: ParentNode, selector: string): T {
    const el = root.querySelector<T>(selector);
    if (!el) throw new Error(`Element not found: ${selector}`);
    return el;
}

function cloneTemplate(id: string): HTMLElement {
    const tpl = document.querySelector<HTMLTemplateElement>(`#${id}`);
    if (!tpl) throw new Error(`Template not found: #${id}`);
    const first = tpl.content.firstElementChild as HTMLElement | null;
    if (!first) throw new Error(`Template #${id} has no root element`);
    return first.cloneNode(true) as HTMLElement;
}

function formatUSDC(amount: number): string {
    const n = Number(amount);
    if (!Number.isFinite(n)) return "0.00 USDC";
    return n.toFixed(2) + " USDC";
}

function showToast(message: string) {
    const notification = document.querySelector<HTMLElement>("#notification");
    if (!notification) {
        alert(message);
        return;
    }
    notification.textContent = message;
    notification.classList.remove("error", "success");
    notification.classList.add("info");
    notification.style.opacity = "1";
    setTimeout(() => {
        if (notification) notification.style.opacity = "0";
    }, 2000);
}

const categoryIcon: Record<AdCategory, string> = {
    follow: "👤",
    visit: "🔗",
    register: "🧾",
    share: "🔁"
};

// ========= Earn 模式：筛选 =========

function getSelectedCategories(): AdCategory[] {
    const checked = Array.from(
        document.querySelectorAll<HTMLInputElement>('input[name="category"]:checked')
    );
    return checked.map((input) => input.value as AdCategory);
}

function getSelectedRewardRanges(): Array<"0.1-0.5" | "0.5-1" | "1+"> {
    const checked = Array.from(
        document.querySelectorAll<HTMLInputElement>('input[name="reward"]:checked')
    );
    return checked.map((input) => input.value as any);
}

function getSortOption(): string {
    const select = document.querySelector<HTMLSelectElement>("#sort-select");
    return select?.value || "reward-high";
}

const DEFAULT_SORT = "reward-high";

/** 读取搜索关键词 */
function getSearchQuery(): string {
    const input = document.querySelector<HTMLInputElement>("#ad-search");
    return (input?.value || "").trim().toLowerCase();
}

/** 搜索匹配：title/brand/description/tags */
function matchAdSearch(ad: EarnAd, qstr: string): boolean {
    if (!qstr) return true;
    const hay = [
        ad.title,
        ad.brand,
        ad.description,
        ...(ad.tags || [])
    ].join(" ").toLowerCase();
    return hay.includes(qstr);
}

/** 当前过滤是否仍是默认状态（用于启用/禁用 Clear filters 按钮） */
function isDefaultFilters(): boolean {
    const qstr = getSearchQuery();
    if (qstr) return false;

    const catInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="category"]'));
    const rewardInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="reward"]'));

    const allCatChecked = catInputs.length > 0 && catInputs.every(i => i.checked);
    const allRewardChecked = rewardInputs.length > 0 && rewardInputs.every(i => i.checked);

    const sort = getSortOption();
    return allCatChecked && allRewardChecked && sort === DEFAULT_SORT;
}

/** 更新搜索清除按钮可见性 + Clear filters 按钮可点状态 */
function updateFilterToolsUI(): void {
    const clearFiltersBtn = document.querySelector<HTMLButtonElement>("#btn-clear-filters");
    if (clearFiltersBtn) clearFiltersBtn.disabled = isDefaultFilters();

    const searchInput = document.querySelector<HTMLInputElement>("#ad-search");
    const clearSearchBtn = document.querySelector<HTMLButtonElement>("#btn-clear-search");

    if (clearSearchBtn) {
        const hasText = !!(searchInput?.value || "").trim();
        // 你的 CSS 用的是 visibility hidden，所以这里保持一致
        clearSearchBtn.style.visibility = hasText ? "visible" : "hidden";
    }
}

/** 重置所有过滤条件到默认状态 */
function resetAllFilters(): void {
    // 清空搜索
    const searchInput = document.querySelector<HTMLInputElement>("#ad-search");
    if (searchInput) searchInput.value = "";

    // 全选所有 category/reward
    document.querySelectorAll<HTMLInputElement>('input[name="category"]').forEach(i => i.checked = true);
    document.querySelectorAll<HTMLInputElement>('input[name="reward"]').forEach(i => i.checked = true);

    // 还原排序
    const sort = document.querySelector<HTMLSelectElement>("#sort-select");
    if (sort) sort.value = DEFAULT_SORT;

    updateFilterToolsUI();
    renderEarnAds();
}

function filterAndSortAds(): EarnAd[] {
    const categories = getSelectedCategories();
    const rewardRanges = getSelectedRewardRanges();
    const sortBy = getSortOption();
    const qstr = getSearchQuery();

    let result = fakeEarnAds.filter((ad) =>
        categories.includes(ad.category) &&
        rewardRanges.includes(ad.rewardRange) &&
        matchAdSearch(ad, qstr)
    );

    switch (sortBy) {
        case "reward-high":
            result = result.slice().sort((a, b) => b.rewardUSDC - a.rewardUSDC);
            break;
        case "newest":
            result = result.slice().sort((a, b) => b.createdAt - a.createdAt);
            break;
        case "time-short":
            result = result.slice().sort((a, b) => a.durationMinutes - b.durationMinutes);
            break;
        case "popular":
            result = result.slice().sort((a, b) => b.popularityScore - a.popularityScore);
            break;
        default:
            break;
    }
    return result;
}

// ========= Earn 模式：渲染广告卡片（模板 clone） =========

function renderEarnAds() {
    const grid = document.querySelector<HTMLElement>(".ad-cards-grid");
    if (!grid) return;

    const emptyState = grid.querySelector<HTMLElement>(".empty-state");
    // 清理旧卡片：只删 .ad-card，保留 empty-state
    grid.querySelectorAll<HTMLElement>(".ad-card").forEach((n) => n.remove());

    if (!emptyState) return;

    const ads = filterAndSortAds();
    if (ads.length === 0) {
        emptyState.style.display = "block";
        return;
    }
    emptyState.style.display = "none";

    ads.forEach((ad) => {
        const card = cloneTemplate("tpl-ad-card");
        card.dataset.adId = ad.id;

        // icon
        const iconEl = q<HTMLElement>(card, ".ad-card-icon");
        iconEl.textContent = categoryIcon[ad.category] || "📢";

        // text fields
        q<HTMLElement>(card, ".ad-card-title").textContent = ad.title;
        q<HTMLElement>(card, ".ad-card-brand").textContent = ad.brand;
        q<HTMLElement>(card, ".ad-card-description").textContent = ad.description;

        q<HTMLElement>(card, ".meta-time").textContent = `⏱️ ${ad.durationMinutes} min`;
        q<HTMLElement>(card, ".meta-quota").textContent = `👥 ${ad.completed}/${ad.totalQuota}`;
        q<HTMLElement>(card, ".meta-deadline").textContent = `📅 ${ad.deadlineText}`;

        q<HTMLElement>(card, ".reward-value").textContent = formatUSDC(ad.rewardUSDC);

        // tags
        const tagsContainer = q<HTMLElement>(card, ".ad-card-tags");
        const tagTpl = q<HTMLElement>(tagsContainer, ".tpl-tag");
        tagTpl.remove(); // 移除占位
        ad.tags.forEach((t) => {
            const tag = tagTpl.cloneNode(true) as HTMLElement;
            tag.className = "tag";
            const low = t.toLowerCase();
            if (low.includes("new")) tag.classList.add("tag-new");
            else if (low.includes("easy")) tag.classList.add("tag-easy");
            else if (low.includes("high")) tag.classList.add("tag-high");
            tag.textContent = t;
            tagsContainer.appendChild(tag);
        });

        const openDetail = () => window.open(ad.detailUrl, "_blank");

        // button
        const btn = q<HTMLButtonElement>(card, ".btn-start-task");
        btn.addEventListener("click", (ev) => {
            ev.stopPropagation();
            showToast(`Start task: ${ad.title}`);
            openDetail();
        });

        // card click
        card.addEventListener("click", openDetail);

        grid.appendChild(card);
    });
}

// ========= 顶部余额 & Earn 概览卡 =========

function renderHeaderBalance() {
    const balanceSpan = document.querySelector<HTMLElement>(".balance-value");
    if (balanceSpan) balanceSpan.textContent = formatUSDC(fakeUserBalanceUSDC);
}

function renderEarnOverview() {
    const totalCard = document.querySelector<HTMLElement>(
        "#view-earn .earnings-overview .overview-card:nth-child(1) .card-value"
    );
    const todayCard = document.querySelector<HTMLElement>(
        "#view-earn .earnings-overview .overview-card:nth-child(2) .card-value"
    );
    const pendingCard = document.querySelector<HTMLElement>(
        "#view-earn .earnings-overview .overview-card:nth-child(3) .card-value"
    );

    if (totalCard) totalCard.textContent = formatUSDC(23.45);
    if (todayCard) todayCard.textContent = formatUSDC(1.25);
    if (pendingCard) pendingCard.textContent = formatUSDC(0.75);
}

// ========= Advertise 仪表盘 =========

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

        q<HTMLElement>(tr, ".td-name").textContent = ad.name;
        q<HTMLElement>(tr, ".td-status").textContent = ad.status;
        q<HTMLElement>(tr, ".td-reward").textContent = formatUSDC(ad.rewardPerTask);
        q<HTMLElement>(tr, ".td-completed").textContent = ad.completed.toString();
        q<HTMLElement>(tr, ".td-spent").textContent = formatUSDC(ad.spent);
        q<HTMLElement>(tr, ".td-remaining").textContent = formatUSDC(ad.remainingBudget);

        const btnView = q<HTMLButtonElement>(tr, ".btn-view");
        const btnToggle = q<HTMLButtonElement>(tr, ".btn-toggle");

        btnView.addEventListener("click", () => showToast(`View ad: ${ad.name}`));

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

        q<HTMLElement>(tr, ".td-time").textContent = r.time;
        q<HTMLElement>(tr, ".td-ad").textContent = r.adName;
        q<HTMLElement>(tr, ".td-event").textContent = r.event;
        q<HTMLElement>(tr, ".td-amount").textContent = formatUSDC(r.amount);
        q<HTMLElement>(tr, ".td-fee").textContent = formatUSDC(r.fee);
        q<HTMLElement>(tr, ".td-status").textContent = r.status;

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
        showToast("Insufficient ad account balance (fake check).");
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
    showToast("Ad published (fake).");
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
                showToast("Address copied (fake).");
            } else {
                showToast(fakeWalletAddress);
            }
        } catch {
            showToast(fakeWalletAddress);
        }
    });

    document.querySelector<HTMLButtonElement>("#btn-buy-card")?.addEventListener("click", () => {
        showToast("Open onramp (fake).");
    });
}

// ========= 历史记录弹窗（模板 clone） =========

function openHistoryModal(defaultTab: "earnings" | "spending" | "recharge" = "earnings") {
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
        q<HTMLElement>(tr, ".td-empty").textContent = msg;
        tbody.appendChild(tr);
        return;
    }

    rows.forEach((row) => {
        const tr = cloneTemplate("tpl-history-row") as HTMLTableRowElement;
        q<HTMLElement>(tr, ".td-time").textContent = row.time;
        q<HTMLElement>(tr, ".td-name").textContent = row.adNameOrMethod;
        q<HTMLElement>(tr, ".td-amount").textContent = formatUSDC(row.amount);
        q<HTMLElement>(tr, ".td-status").textContent = row.status;
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
    document.querySelector<HTMLButtonElement>("#btn-my-earnings")?.addEventListener("click", () => openHistoryModal("earnings"));
    document.querySelector<HTMLButtonElement>("#close-history")?.addEventListener("click", closeHistoryModal);

    document.querySelectorAll<HTMLButtonElement>(".history-tab").forEach((btn) => {
        btn.addEventListener("click", () => {
            const tab = (btn.dataset.tab || "earnings") as any;
            switchHistoryTab(tab);
        });
    });
}

// ========= 模式切换 (Earn / Advertise) =========

function initModeSwitch() {
    const btnEarn = document.querySelector<HTMLButtonElement>("#mode-earn");
    const btnAdv = document.querySelector<HTMLButtonElement>("#mode-advertise");
    const viewEarn = document.querySelector<HTMLElement>("#view-earn");
    const viewAdv = document.querySelector<HTMLElement>("#view-advertise");
    if (!btnEarn || !btnAdv || !viewEarn || !viewAdv) return;

    btnEarn.addEventListener("click", () => {
        btnEarn.classList.add("active");
        btnAdv.classList.remove("active");
        viewEarn.classList.add("active");
        viewAdv.classList.remove("active");
    });

    btnAdv.addEventListener("click", () => {
        btnAdv.classList.add("active");
        btnEarn.classList.remove("active");
        viewAdv.classList.add("active");
        viewEarn.classList.remove("active");
    });
}

// ========= 事件绑定：筛选 / Wizard =========

function initEarnFiltersEvents() {
    const onAnyFilterChanged = () => {
        updateFilterToolsUI();
        renderEarnAds();
    };

    document.querySelectorAll<HTMLInputElement>('input[name="category"]').forEach((cb) =>
        cb.addEventListener("change", onAnyFilterChanged)
    );
    document.querySelectorAll<HTMLInputElement>('input[name="reward"]').forEach((cb) =>
        cb.addEventListener("change", onAnyFilterChanged)
    );
    document.querySelector<HTMLSelectElement>("#sort-select")?.addEventListener("change", onAnyFilterChanged);

    // 搜索：输入实时过滤（也可改成 debounce，但你现在假数据不需要）
    const searchInput = document.querySelector<HTMLInputElement>("#ad-search");
    searchInput?.addEventListener("input", onAnyFilterChanged);

    // 清除搜索
    document.querySelector<HTMLButtonElement>("#btn-clear-search")?.addEventListener("click", () => {
        if (searchInput) searchInput.value = "";
        updateFilterToolsUI();
        renderEarnAds();
        searchInput?.focus();
    });

    // 一键清除过滤
    document.querySelector<HTMLButtonElement>("#btn-clear-filters")?.addEventListener("click", () => {
        resetAllFilters();
    });
}

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

function initAdPlaza() {
    renderHeaderBalance();
    renderEarnOverview();
    renderEarnAds();

    renderAdvertiseDashboard();
    renderMyAdsTable();
    renderSpendTable();

    initModeSwitch();
    initEarnFiltersEvents();
    initWizardEvents();
    initRechargeModalEvents();
    initHistoryModalEvents();
    updateFilterToolsUI();
}

document.addEventListener("DOMContentLoaded", () => {
    try {
        initAdPlaza();
    } catch (err) {
        console.error("Ad Plaza init error:", err);
    }
});
