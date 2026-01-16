import {
    $,
    $2,
    atomicToUsdcNumber,
    cloneTemplate,
    formatUSDC,
    multiplyAtomic,
    showNotification,
    usdcToAtomic
} from "./common";
import {ChainNameBaseMain, walletInfo, X402_FACILITATORS} from "../common/x402_obj";
import {getChainId} from "../wallet/wallet_setting";
import {queryCdpWalletInfo} from "../wallet/cdp_wallet";
import {logAdP} from "../common/debug_flags";

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

interface AdRecord {
    ad_id: string;
    a_x_id: string;
    ad_type: string;
    category: string;
    name: string;
    title: string;
    description: string;
    detail_url: string;
    unit_price_atomic: string;
    quota_total: number;
    quota_used: number;
    status: string;
    start_at?: string | null;
    end_at?: string | null;
    created_at: string;
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

// ========= 数据存储 =========

let adAccountBalanceAtomic = "0";
let myAds: AdRecord[] = [];
let spendRecords: SpendRecord[] = [];
let historyEarnings: HistoryRow[] = [];
let historySpending: HistoryRow[] = [];
let historyRecharge: HistoryRow[] = [];
let walletInfoCache: walletInfo | null = null;

// ========= API helpers =========

/**
 * 初始化钱包信息并更新 UI
 * @throws 如果用户未登录
 */
async function initWalletInfo(): Promise<void> {
    const chainId = await getChainId();
    walletInfoCache = await queryCdpWalletInfo(chainId);

    if (!walletInfoCache.hasCreated) {
        throw new Error("Please sign in and create wallet first");
    }

    if (!walletInfoCache.xId) {
        throw new Error("X account not connected. Please sign in with X");
    }

    // 更新头部信息
    updateHeaderInfo();
    // 更新推特头像
    updateTwitterAvatar();
}

/**
 * 更新头部的网络和地址显示
 */
function updateHeaderInfo(): void {
    if (!walletInfoCache) return;

    const networkEl = document.querySelector<HTMLElement>("#header-network");
    const accountEl = document.querySelector<HTMLElement>("#header-account");
    const BalanceEl = document.querySelector<HTMLElement>("#balance-value");

    if (networkEl) {
        const cfg = X402_FACILITATORS[walletInfoCache.chainId]
        networkEl.textContent = cfg.network || ChainNameBaseMain;
    }

    if (accountEl && walletInfoCache.address) {
        const addr = walletInfoCache.address;
        accountEl.textContent = `${addr.slice(0, 6)}...${addr.slice(-4)}`;
        accountEl.title = addr;
    }
    if (BalanceEl) {
        BalanceEl.textContent = walletInfoCache.usdcVal
    }
}

/**
 * 更新推特头像
 */
function updateTwitterAvatar(): void {
    if (!walletInfoCache?.username) return;

    const avatarImg = document.querySelector<HTMLImageElement>("#twitter-avatar");
    const userNameEl = document.querySelector<HTMLImageElement>("#twitter-user-name");

    if (avatarImg) {
        avatarImg.src = `https://unavatar.io/twitter/${walletInfoCache.username}`;
        avatarImg.onerror = () => {
            avatarImg.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ccircle cx='50' cy='50' r='50' fill='%23e5e7eb'/%3E%3Ctext x='50' y='65' text-anchor='middle' fill='%239ca3af' font-size='40' font-family='sans-serif'%3E👤%3C/text%3E%3C/svg%3E";
        };
    }

    if (userNameEl) {
        userNameEl.textContent = walletInfoCache.username;
    }
}

/**
 * 获取当前用户的 X ID
 */
function getCurrentXId(): string {
    if (!walletInfoCache?.xId) {
        throw new Error("X ID not available");
    }
    return walletInfoCache.xId;
}

async function fetchAdsBalance(aXId: string) {
    const chainId = await getChainId();
    const url = X402_FACILITATORS[chainId].endpoint + "/ads/balance";
    const response = await fetch(`${url}?a_x_id=${encodeURIComponent(aXId)}`);
    if (!response.ok) throw new Error(await response.text());
    return await response.json();
}

async function fetchMyAds(aXId: string): Promise<AdRecord[]> {
    const chainId = await getChainId();
    const url = X402_FACILITATORS[chainId].endpoint + "/ads/my_ads";
    const response = await fetch(`${url}?a_x_id=${encodeURIComponent(aXId)}`);
    if (!response.ok) throw new Error(await response.text());
    return (await response.json()) as AdRecord[];
}

async function createAd(payload: Record<string, any>): Promise<{ ok: boolean; data?: any; error?: any }> {
    const chainId = await getChainId();
    const url = X402_FACILITATORS[chainId].endpoint + "/ads/create";
    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        return {ok: false, error: data};
    }
    return {ok: true, data};
}

async function refreshAdsData() {
    const currentXId = getCurrentXId();
    const [balance, ads] = await Promise.all([
        fetchAdsBalance(currentXId),
        fetchMyAds(currentXId),
    ]);
    adAccountBalanceAtomic = balance?.balance_atomic ?? "0";
    myAds = Array.isArray(ads) ? ads : [];

    logAdP("------>>> balance:", balance, " my ads:", myAds)

    renderHeaderBalance();
    renderAdvertiseDashboard();
    renderMyAdsTable();
    updateBudgetSummaryAndBalance();
}

// ========= 顶部余额 & Advertise 仪表盘 =========

function renderHeaderBalance() {
    const balanceSpan = document.querySelector<HTMLElement>(".balance-value");
    if (balanceSpan) balanceSpan.textContent = formatUSDC(atomicToUsdcNumber(adAccountBalanceAtomic));
}

function renderAdvertiseDashboard() {
    const cards = document.querySelectorAll<HTMLElement>("#view-advertise .dashboard-card");

    const card1Value = cards[0]?.querySelector<HTMLElement>(".card-value");
    if (card1Value) card1Value.textContent = formatUSDC(atomicToUsdcNumber(adAccountBalanceAtomic));

    const activeCount = myAds.filter((ad) => ad.status === "ACTIVE").length;
    const card2Value = cards[1]?.querySelector<HTMLElement>(".card-value");
    if (card2Value) card2Value.textContent = activeCount.toString();

    // 计算今日支出：从 myAds 中统计所有已使用的配额
    const todaySpend = myAds.reduce((sum, ad) => {
        const spent = atomicToUsdcNumber(multiplyAtomic(ad.unit_price_atomic, ad.quota_used));
        return sum + spent;
    }, 0);
    const card3Value = cards[2]?.querySelector<HTMLElement>(".card-value");
    if (card3Value) card3Value.textContent = formatUSDC(todaySpend);

    // 本周支出暂时使用相同的值（需要服务器支持日期过滤）
    const weekSpend = todaySpend;
    const card4Value = cards[3]?.querySelector<HTMLElement>(".card-value");
    if (card4Value) card4Value.textContent = formatUSDC(weekSpend);
}

// ========= My Ads 表格（模板 clone） =========

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

function renderMyAdsTable() {
    const tbody = document.querySelector<HTMLTableSectionElement>("#my-ads-tbody");
    if (!tbody) return;

    tbody.replaceChildren();

    if (myAds.length === 0) {
        tbody.appendChild(cloneTemplate("tpl-empty-my-ads-row") as any);
        return;
    }

    myAds.map(buildMyAdRow).forEach((ad) => {
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

        btnToggle.textContent = "N/A";
        btnToggle.disabled = true;

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

    const reward = rewardInput?.value || "0";
    const tasks = Number(taskLimitInput?.value || "0");

    const unitAtomic = usdcToAtomic(reward);
    const requiredAtomic = unitAtomic && Number.isFinite(tasks) ? multiplyAtomic(unitAtomic, tasks) : "0";
    const requiredUsdc = atomicToUsdcNumber(requiredAtomic);

    const fee = 0;
    const total = requiredUsdc + fee;

    $("#summary-reward").textContent = formatUSDC(Number(reward) || 0);
    $("#summary-tasks").textContent = Number.isFinite(tasks) ? tasks.toString() : "0";
    $("#summary-fee").textContent = formatUSDC(fee);
    $("#summary-total").textContent = formatUSDC(total);

    $("#current-balance").textContent = formatUSDC(atomicToUsdcNumber(adAccountBalanceAtomic));

    const balanceStatus = $("#balance-status");
    balanceStatus.className = "balance-status";

    if (requiredAtomic && BigInt(requiredAtomic) > 0n && BigInt(adAccountBalanceAtomic) >= BigInt(requiredAtomic)) {
        balanceStatus.classList.add("sufficient");
        balanceStatus.textContent = "Your balance is sufficient to publish this ad.";
    } else if (requiredAtomic && BigInt(requiredAtomic) > 0n && BigInt(adAccountBalanceAtomic) < BigInt(requiredAtomic)) {
        balanceStatus.classList.add("insufficient");
        balanceStatus.textContent = "Insufficient balance. Please recharge before publishing.";
    } else {
        balanceStatus.textContent = "";
    }
}

async function submitWizard() {
    const currentXId = getCurrentXId();

    const nameInput = document.querySelector<HTMLInputElement>("#ad-name");
    const adTypeInput = document.querySelector<HTMLSelectElement>("#ad-type");
    const adCategoryInput = document.querySelector<HTMLSelectElement>("#ad-category");
    const adTitleInput = document.querySelector<HTMLInputElement>("#ad-title");
    const adDescriptionInput = document.querySelector<HTMLTextAreaElement>("#ad-description");
    const adUrlInput = document.querySelector<HTMLInputElement>("#ad-url");
    const rewardInput = document.querySelector<HTMLInputElement>("#reward-amount");
    const taskLimitInput = document.querySelector<HTMLInputElement>("#task-limit");
    const startAtInput = document.querySelector<HTMLInputElement>("#start-time");
    const endAtInput = document.querySelector<HTMLInputElement>("#end-time");
    const taskActionInput = document.querySelector<HTMLSelectElement>("#task-action");

    const name = nameInput?.value?.trim() || "";
    const adType = adTypeInput?.value?.trim() || "";
    const category = adCategoryInput?.value?.trim() || taskActionInput?.value?.trim() || "";
    const title = adTitleInput?.value?.trim() || "";
    const description = adDescriptionInput?.value?.trim() || "";
    const detailUrl = adUrlInput?.value?.trim() || "";

    const reward = rewardInput?.value || "";
    const quotaTotal = Number(taskLimitInput?.value || "0");
    const unitPriceAtomic = usdcToAtomic(reward);

    if (!name || !adType || !category || !title || !description || !detailUrl || !unitPriceAtomic || quotaTotal <= 0) {
        showNotification("Please complete required fields.", "error");
        return;
    }

    const payload = {
        a_x_id: currentXId,
        ad_type: adType,
        category,
        name,
        title,
        description,
        detail_url: detailUrl,
        unit_price_atomic: unitPriceAtomic,
        quota_total: quotaTotal,
        start_at: startAtInput?.value || null,
        end_at: endAtInput?.value || null,
    };

    const result = await createAd(payload);
    if (!result.ok) {
        if (result.error?.error === "INSUFFICIENT_BALANCE") {
            showNotification(`余额不足。需要 ${result.error?.detail || ""}`.trim(), "error");
            return;
        }
        showNotification("Failed to create ad.", "error");
        return;
    }

    showNotification("创建成功", "success");
    closeWizard();
    await refreshAdsData();
}

// ========= 充值弹窗 =========

function openRechargeModal() {
    const modal = document.querySelector<HTMLElement>("#recharge-modal");
    const addrEl = document.querySelector<HTMLElement>("#wallet-address-display");
    if (addrEl && walletInfoCache?.address) {
        addrEl.textContent = walletInfoCache.address;
    }
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
        if (!walletInfoCache?.address) return;
        try {
            if (navigator.clipboard) {
                await navigator.clipboard.writeText(walletInfoCache.address);
                showNotification("Address copied.");
            } else {
                showNotification(walletInfoCache.address);
            }
        } catch {
            showNotification(walletInfoCache.address);
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
        $2<HTMLElement>(tr, ".td-empty").textContent = tab === "earnings" ? "No earnings yet" :
            tab === "spending" ? "No spending yet" :
                "No recharge records";
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
function initNavEvents() {
    document.querySelector<HTMLButtonElement>("#btn-back-plaza")?.addEventListener("click", () => {
        window.location.href = "ad_plaza.html";
    });
}

function initSpendTabs() {
    const group = document.querySelector<HTMLElement>('.dashboard-group[data-group="spend"]');
    if (!group) return;

    const tabs = Array.from(group.querySelectorAll<HTMLButtonElement>(".dashboard-tab"));
    const cards = Array.from(group.querySelectorAll<HTMLElement>('.dashboard-card[data-range]'));

    if (tabs.length === 0 || cards.length === 0) return;

    const setRange = (range: string) => {
        tabs.forEach((t) => t.classList.toggle("active", (t.dataset.range || "") === range));
        cards.forEach((c) => c.classList.toggle("is-hidden", (c.dataset.range || "") !== range));
    };

    // 初始状态：以 DOM 上默认 active tab 为准，否则用第一个
    const defaultRange =
        tabs.find((t) => t.classList.contains("active"))?.dataset.range ||
        tabs[0].dataset.range ||
        "today";

    setRange(defaultRange);

    tabs.forEach((t) => {
        t.addEventListener("click", () => setRange(t.dataset.range || "today"));
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

async function initAdvertise() {
    renderHeaderBalance();
    renderAdvertiseDashboard();
    renderMyAdsTable();
    renderSpendTable();

    initNavEvents();
    initSpendTabs();

    initWizardEvents();
    initRechargeModalEvents();
    initHistoryModalEvents();

    try {
        await initWalletInfo();
        logAdP("------>>> wallet info:", walletInfoCache);
        await refreshAdsData();
    } catch (err) {
        console.error("Failed to initialize wallet info:", err);
        showNotification((err as Error).message || "Please sign in first.", "error");
    }
}

document.addEventListener("DOMContentLoaded", () => {
    initAdvertise().catch((err) => {
        console.error("Advertise init error:", err);
    });
});
