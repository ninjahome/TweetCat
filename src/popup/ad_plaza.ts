// ad_plaza.ts
// 用假数据驱动 Ad Plaza 的所有界面和按钮交互

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

// Earn 模式的广告列表
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

// 广告主的假账户余额（头部 + Advertise 仪表盘共用）
let fakeUserBalanceUSDC = 123.45; // 顶部 Balance
let fakeAdAccountBalanceUSDC = 80.0; // Advertise 仪表盘里的 Ad Account Balance

// 我的广告列表
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

// 最近消费记录
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

// 历史记录（简单用假数组）
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

// 假钱包地址
const fakeWalletAddress = "0xDEMO1234567890abcdef1234567890ABCDEF0000";

// ========= 工具函数 =========

function $(selector: string): HTMLElement {
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) {
        throw new Error(`Element not found: ${selector}`);
    }
    return el;
}

function formatUSDC(amount: number): string {
    return amount.toFixed(2) + " USDC";
}

// 简单 toast，可以后续改成你自己的 notification 组件
function showToast(message: string) {
    // 先尝试使用现有的 notification DOM（如果有）
    let notification = document.querySelector<HTMLElement>("#notification");
    if (!notification) {
        alert(message);
        return;
    }
    notification.textContent = message;
    notification.classList.remove("error", "success");
    notification.classList.add("info");
    notification.style.opacity = "1";
    setTimeout(() => {
        notification && (notification.style.opacity = "0");
    }, 2000);
}

// ========= Earn 模式：广告列表渲染 & 筛选 =========

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

function filterAndSortAds(): EarnAd[] {
    const categories = getSelectedCategories();
    const rewardRanges = getSelectedRewardRanges();
    const sortBy = getSortOption();

    let result = fakeEarnAds.filter((ad) => {
        const inCat = categories.includes(ad.category);
        const inRange = rewardRanges.includes(ad.rewardRange);
        return inCat && inRange;
    });

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

function renderEarnAds() {
    const grid = document.querySelector<HTMLElement>(".ad-cards-grid");
    if (!grid) return;

    const emptyState = grid.querySelector<HTMLElement>(".empty-state");
    // 删除旧的卡片（保留 emptyState 节点）
    Array.from(grid.children).forEach((child) => {
        if (child !== emptyState) {
            grid.removeChild(child);
        }
    });

    const ads = filterAndSortAds();

    if (!emptyState) {
        return;
    }

    if (ads.length === 0) {
        emptyState.style.display = "block";
        return;
    }

    emptyState.style.display = "none";

    ads.forEach((ad) => {
        const card = document.createElement("div");
        card.className = "ad-card";

        // 图片区域
        const imgDiv = document.createElement("div");
        imgDiv.className = "ad-card-image";
        const imgSpan = document.createElement("span");
        imgSpan.textContent = "📢";
        imgSpan.style.fontSize = "40px";
        imgDiv.appendChild(imgSpan);

        // 内容区域
        const content = document.createElement("div");
        content.className = "ad-card-content";

        const header = document.createElement("div");
        header.className = "ad-card-header";

        const title = document.createElement("h3");
        title.className = "ad-card-title";
        title.textContent = ad.title;

        const brand = document.createElement("div");
        brand.className = "ad-card-brand";
        brand.textContent = ad.brand;

        header.appendChild(title);
        header.appendChild(brand);

        const desc = document.createElement("p");
        desc.className = "ad-card-description";
        desc.textContent = ad.description;

        const meta = document.createElement("div");
        meta.className = "ad-card-meta";

        const mTime = document.createElement("span");
        mTime.className = "meta-item";
        mTime.textContent = `⏱️ ${ad.durationMinutes} min`;

        const mQuota = document.createElement("span");
        mQuota.className = "meta-item";
        mQuota.textContent = `👥 ${ad.completed}/${ad.totalQuota}`;

        const mDeadline = document.createElement("span");
        mDeadline.className = "meta-item";
        mDeadline.textContent = `📅 ${ad.deadlineText}`;

        meta.appendChild(mTime);
        meta.appendChild(mQuota);
        meta.appendChild(mDeadline);

        const tagsDiv = document.createElement("div");
        tagsDiv.className = "ad-card-tags";
        ad.tags.forEach((tagText) => {
            const tag = document.createElement("span");
            tag.className = "tag";
            if (tagText.toLowerCase().includes("new")) {
                tag.classList.add("tag-new");
            } else if (tagText.toLowerCase().includes("easy")) {
                tag.classList.add("tag-easy");
            } else if (tagText.toLowerCase().includes("high")) {
                tag.classList.add("tag-high");
            }
            tag.textContent = tagText;
            tagsDiv.appendChild(tag);
        });

        content.appendChild(header);
        content.appendChild(desc);
        content.appendChild(meta);
        content.appendChild(tagsDiv);

        // 底部区域
        const footer = document.createElement("div");
        footer.className = "ad-card-footer";

        const rewardDiv = document.createElement("div");
        rewardDiv.className = "ad-card-reward";

        const rLabel = document.createElement("span");
        rLabel.className = "reward-label";
        rLabel.textContent = "Earn:";

        const rValue = document.createElement("span");
        rValue.className = "reward-value";
        rValue.textContent = `${ad.rewardUSDC.toFixed(2)} USDC`;

        rewardDiv.appendChild(rLabel);
        rewardDiv.appendChild(rValue);

        const btn = document.createElement("button");
        btn.className = "btn-start-task";
        btn.textContent = "Start Task";

        btn.addEventListener("click", (ev) => {
            ev.stopPropagation();
            showToast(`Start task: ${ad.title}`);
            // 假逻辑：打开一个新的 tab，模拟广告详情页
            window.open(ad.detailUrl, "_blank");
        });

        footer.appendChild(rewardDiv);
        footer.appendChild(btn);

        // 整个卡片点击也可以进入
        card.addEventListener("click", () => {
            window.open(ad.detailUrl, "_blank");
        });

        card.appendChild(imgDiv);
        card.appendChild(content);
        card.appendChild(footer);

        grid.appendChild(card);
    });
}

// ========= 顶部余额 & Earn 概览卡 =========

function renderHeaderBalance() {
    const balanceSpan = document.querySelector<HTMLElement>(".balance-value");
    if (balanceSpan) {
        balanceSpan.textContent = formatUSDC(fakeUserBalanceUSDC);
    }
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

// ========= Advertise 仪表盘 & 我的广告 & 消费记录 =========

function renderAdvertiseDashboard() {
    const cards = document.querySelectorAll<HTMLElement>("#view-advertise .dashboard-card");

    // Card1: Ad Account Balance + 按钮
    const card1Value = cards[0]?.querySelector<HTMLElement>(".card-value");
    if (card1Value) card1Value.textContent = formatUSDC(fakeAdAccountBalanceUSDC);

    // Card2: Active Ads
    const activeCount = myAds.filter((ad) => ad.status === "Active").length;
    const card2Value = cards[1]?.querySelector<HTMLElement>(".card-value");
    if (card2Value) card2Value.textContent = activeCount.toString();

    // Card3 & Card4：简单用假数据
    const todaySpend = spendRecords.reduce((sum, r) => sum + (r.amount + r.fee), 0);
    const card3Value = cards[2]?.querySelector<HTMLElement>(".card-value");
    if (card3Value) card3Value.textContent = formatUSDC(todaySpend);

    const weekSpend = todaySpend * 3; // 随便乘个系数
    const card4Value = cards[3]?.querySelector<HTMLElement>(".card-value");
    if (card4Value) card4Value.textContent = formatUSDC(weekSpend);
}

function renderMyAdsTable() {
    const tbody = document.querySelector<HTMLTableSectionElement>("#my-ads-tbody");
    if (!tbody) return;

    tbody.innerHTML = "";

    if (myAds.length === 0) {
        const tr = document.createElement("tr");
        tr.className = "empty-row";
        const td = document.createElement("td");
        td.colSpan = 7;
        td.innerHTML =
            '<div class="empty-state-small"><p>No ads published yet. Click "Publish New Ad" to get started!</p></div>';
        tr.appendChild(td);
        tbody.appendChild(tr);
        return;
    }

    myAds.forEach((ad) => {
        const tr = document.createElement("tr");

        const nameTd = document.createElement("td");
        nameTd.textContent = ad.name;

        const statusTd = document.createElement("td");
        statusTd.textContent = ad.status;

        const rewardTd = document.createElement("td");
        rewardTd.textContent = formatUSDC(ad.rewardPerTask);

        const completedTd = document.createElement("td");
        completedTd.textContent = ad.completed.toString();

        const spentTd = document.createElement("td");
        spentTd.textContent = formatUSDC(ad.spent);

        const remainTd = document.createElement("td");
        remainTd.textContent = formatUSDC(ad.remainingBudget);

        const actionsTd = document.createElement("td");

        const btnView = document.createElement("button");
        btnView.className = "btn-secondary";
        btnView.style.marginRight = "8px";
        btnView.textContent = "View";
        btnView.addEventListener("click", () => {
            showToast(`View ad: ${ad.name}`);
        });

        const btnToggle = document.createElement("button");
        btnToggle.className = "btn-secondary";
        btnToggle.textContent = ad.status === "Active" ? "Pause" : "Resume";
        btnToggle.addEventListener("click", () => {
            ad.status = ad.status === "Active" ? "Paused" : "Active";
            renderMyAdsTable();
            renderAdvertiseDashboard();
        });

        actionsTd.appendChild(btnView);
        actionsTd.appendChild(btnToggle);

        tr.appendChild(nameTd);
        tr.appendChild(statusTd);
        tr.appendChild(rewardTd);
        tr.appendChild(completedTd);
        tr.appendChild(spentTd);
        tr.appendChild(remainTd);
        tr.appendChild(actionsTd);

        tbody.appendChild(tr);
    });
}

function renderSpendTable() {
    const tbody = document.querySelector<HTMLTableSectionElement>("#spending-tbody");
    if (!tbody) return;

    tbody.innerHTML = "";

    if (spendRecords.length === 0) {
        const tr = document.createElement("tr");
        tr.className = "empty-row";
        const td = document.createElement("td");
        td.colSpan = 6;
        td.innerHTML = '<div class="empty-state-small"><p>No spending records yet.</p></div>';
        tr.appendChild(td);
        tbody.appendChild(tr);
        return;
    }

    spendRecords.forEach((r) => {
        const tr = document.createElement("tr");

        const tTime = document.createElement("td");
        tTime.textContent = r.time;

        const tAd = document.createElement("td");
        tAd.textContent = r.adName;

        const tEvent = document.createElement("td");
        tEvent.textContent = r.event;

        const tAmount = document.createElement("td");
        tAmount.textContent = formatUSDC(r.amount);

        const tFee = document.createElement("td");
        tFee.textContent = formatUSDC(r.fee);

        const tStatus = document.createElement("td");
        tStatus.textContent = r.status;

        tr.appendChild(tTime);
        tr.appendChild(tAd);
        tr.appendChild(tEvent);
        tr.appendChild(tAmount);
        tr.appendChild(tFee);
        tr.appendChild(tStatus);

        tbody.appendChild(tr);
    });
}

// ========= 发布广告向导（Wizard） =========

let wizardCurrentStep = 1;
const wizardMaxStep = 4;

function openWizard() {
    wizardCurrentStep = 1;
    updateWizardUI();
    const modal = document.querySelector<HTMLElement>("#publish-wizard-modal");
    modal?.classList.add("active");
}

function closeWizard() {
    const modal = document.querySelector<HTMLElement>("#publish-wizard-modal");
    modal?.classList.remove("active");
}

function updateWizardUI() {
    // 步骤指示器
    const steps = document.querySelectorAll<HTMLElement>(".wizard-step");
    steps.forEach((stepEl) => {
        const step = Number(stepEl.dataset.step);
        stepEl.classList.toggle("active", step === wizardCurrentStep);
        stepEl.classList.toggle("completed", step < wizardCurrentStep);
    });

    // 内容
    const contents = document.querySelectorAll<HTMLElement>(".wizard-content");
    contents.forEach((c) => {
        const step = Number(c.dataset.step);
        c.classList.toggle("active", step === wizardCurrentStep);
    });

    // 底部按钮
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
        // 最后一步实时更新预算/余额检查
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

// 预算计算
function updateBudgetSummaryAndBalance() {
    const rewardInput = document.querySelector<HTMLInputElement>("#reward-amount");
    const taskLimitInput = document.querySelector<HTMLInputElement>("#task-limit");

    const reward = Number(rewardInput?.value || "0");
    const tasks = Number(taskLimitInput?.value || "0");

    const rewardSpan = $("#summary-reward");
    const tasksSpan = $("#summary-tasks");
    const feeSpan = $("#summary-fee");
    const totalSpan = $("#summary-total");
    const currentBalSpan = $("#current-balance");
    const balanceStatus = $("#balance-status");

    const base = reward * tasks;
    const fee = base * 0.05;
    const total = base + fee;

    rewardSpan.textContent = formatUSDC(isNaN(reward) ? 0 : reward);
    tasksSpan.textContent = isNaN(tasks) ? "0" : tasks.toString();
    feeSpan.textContent = formatUSDC(isNaN(fee) ? 0 : fee);
    totalSpan.textContent = formatUSDC(isNaN(total) ? 0 : total);

    currentBalSpan.textContent = formatUSDC(fakeAdAccountBalanceUSDC);

    balanceStatus.className = "balance-status";
    if (!isNaN(total) && total > 0 && total <= fakeAdAccountBalanceUSDC) {
        balanceStatus.classList.add("sufficient");
        balanceStatus.textContent = "Your balance is sufficient to publish this ad.";
    } else if (!isNaN(total) && total > fakeAdAccountBalanceUSDC) {
        balanceStatus.classList.add("insufficient");
        balanceStatus.textContent = "Insufficient balance. Please recharge before publishing.";
    } else {
        balanceStatus.textContent = "";
    }
}

function submitWizard() {
    // 简单收集几个字段，创建一条新的 MyAdRow 假数据
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
    fakeAdAccountBalanceUSDC -= total * 0.1; // 只是演示：随便扣一点，避免变成负数

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
    const modal = document.querySelector<HTMLElement>("#recharge-modal");
    modal?.classList.remove("active");
}

function initRechargeModalEvents() {
    const btnRechargeHeader = document.querySelector<HTMLButtonElement>("#btn-recharge");
    const btnRechargeDashboard = document.querySelector<HTMLButtonElement>("#btn-recharge-dashboard");
    const closeBtn = document.querySelector<HTMLButtonElement>("#close-recharge");
    const copyBtn = document.querySelector<HTMLButtonElement>("#copy-address");
    const buyBtn = document.querySelector<HTMLButtonElement>("#btn-buy-card");

    btnRechargeHeader?.addEventListener("click", openRechargeModal);
    btnRechargeDashboard?.addEventListener("click", openRechargeModal);
    closeBtn?.addEventListener("click", closeRechargeModal);

    copyBtn?.addEventListener("click", async () => {
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

    buyBtn?.addEventListener("click", () => {
        showToast("Open onramp (fake).");
    });
}

// ========= 历史记录弹窗 =========

function openHistoryModal(defaultTab: "earnings" | "spending" | "recharge" = "earnings") {
    const modal = document.querySelector<HTMLElement>("#history-modal");
    modal?.classList.add("active");
    switchHistoryTab(defaultTab);
}

function closeHistoryModal() {
    const modal = document.querySelector<HTMLElement>("#history-modal");
    modal?.classList.remove("active");
}

function switchHistoryTab(tab: string) {
    const tabButtons = document.querySelectorAll<HTMLButtonElement>(".history-tab");
    const contents = document.querySelectorAll<HTMLElement>(".history-tab-content");

    tabButtons.forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.tab === tab);
    });
    contents.forEach((c) => {
        c.classList.toggle("active", c.dataset.tab === tab);
    });

    // 渲染对应表格
    if (tab === "earnings") {
        renderHistoryTable("earnings", historyEarnings);
    } else if (tab === "spending") {
        renderHistoryTable("spending", historySpending);
    } else if (tab === "recharge") {
        renderHistoryTable("recharge", historyRecharge);
    }
}

function renderHistoryTable(tab: string, rows: HistoryRow[]) {
    const tbody = document.querySelector<HTMLTableSectionElement>(
        `.history-tab-content[data-tab="${tab}"] tbody`
    );
    if (!tbody) return;

    tbody.innerHTML = "";

    if (rows.length === 0) {
        const tr = document.createElement("tr");
        tr.className = "empty-row";
        const td = document.createElement("td");
        td.colSpan = 4;
        td.textContent = "No records";
        tr.appendChild(td);
        tbody.appendChild(tr);
        return;
    }

    rows.forEach((row) => {
        const tr = document.createElement("tr");

        const tdTime = document.createElement("td");
        tdTime.textContent = row.time;

        const tdName = document.createElement("td");
        tdName.textContent = row.adNameOrMethod;

        const tdAmount = document.createElement("td");
        tdAmount.textContent = formatUSDC(row.amount);

        const tdStatus = document.createElement("td");
        tdStatus.textContent = row.status;

        tr.appendChild(tdTime);
        tr.appendChild(tdName);
        tr.appendChild(tdAmount);
        tr.appendChild(tdStatus);

        tbody.appendChild(tr);
    });
}

function initHistoryModalEvents() {
    const btnHistory = document.querySelector<HTMLButtonElement>("#btn-history");
    const btnMyEarnings = document.querySelector<HTMLButtonElement>("#btn-my-earnings");
    const closeBtn = document.querySelector<HTMLButtonElement>("#close-history");

    btnHistory?.addEventListener("click", () => openHistoryModal("spending"));
    btnMyEarnings?.addEventListener("click", () => openHistoryModal("earnings"));
    closeBtn?.addEventListener("click", closeHistoryModal);

    const tabButtons = document.querySelectorAll<HTMLButtonElement>(".history-tab");
    tabButtons.forEach((btn) => {
        btn.addEventListener("click", () => {
            const tab = btn.dataset.tab || "earnings";
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

// ========= 事件绑定：筛选 / 排序 / Wizard / 其它 =========

function initEarnFiltersEvents() {
    const categoryCheckboxes = document.querySelectorAll<HTMLInputElement>('input[name="category"]');
    const rewardCheckboxes = document.querySelectorAll<HTMLInputElement>('input[name="reward"]');
    const sortSelect = document.querySelector<HTMLSelectElement>("#sort-select");

    categoryCheckboxes.forEach((cb) => cb.addEventListener("change", renderEarnAds));
    rewardCheckboxes.forEach((cb) => cb.addEventListener("change", renderEarnAds));
    sortSelect?.addEventListener("change", renderEarnAds);
}

function initWizardEvents() {
    const openBtn = document.querySelector<HTMLButtonElement>("#btn-publish-ad");
    const closeBtn = document.querySelector<HTMLButtonElement>("#close-wizard");
    const prevBtn = document.querySelector<HTMLButtonElement>("#btn-wizard-prev");
    const nextBtn = document.querySelector<HTMLButtonElement>("#btn-wizard-next");
    const submitBtn = document.querySelector<HTMLButtonElement>("#btn-wizard-submit");

    openBtn?.addEventListener("click", openWizard);
    closeBtn?.addEventListener("click", closeWizard);
    prevBtn?.addEventListener("click", goWizardPrev);
    nextBtn?.addEventListener("click", goWizardNext);
    submitBtn?.addEventListener("click", submitWizard);

    // 当 reward 或 task 输入变化时，实时更新预算信息（即便不在第4步也没关系）
    const rewardInput = document.querySelector<HTMLInputElement>("#reward-amount");
    const taskLimitInput = document.querySelector<HTMLInputElement>("#task-limit");

    rewardInput?.addEventListener("input", updateBudgetSummaryAndBalance);
    taskLimitInput?.addEventListener("input", updateBudgetSummaryAndBalance);
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
}

// DOM Ready
document.addEventListener("DOMContentLoaded", () => {
    try {
        initAdPlaza();
    } catch (err) {
        // 如果有报错，至少保证页面不会完全挂掉
        // eslint-disable-next-line no-console
        console.error("Ad Plaza init error:", err);
    }
});
