// ad_plaza.ts
// 用假数据驱动 Earn 页面的界面和按钮交互
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

const fakeWithdrawableUSDC = 12.34;
const fakeTotalEarnedUSDC = 23.45;
const fakeTodayEarnedUSDC = 1.25;
const fakePendingUSDC = 0.75;

// ========= 工具函数 =========

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

// ========= Earn 主卡信息 =========

function renderEarnSummary() {
    const withdrawable = document.querySelector<HTMLElement>("#withdrawable-amount");
    const total = document.querySelector<HTMLElement>("#total-earned");
    const today = document.querySelector<HTMLElement>("#today-earned");
    const pending = document.querySelector<HTMLElement>("#pending-earned");

    if (withdrawable) withdrawable.textContent = formatUSDC(fakeWithdrawableUSDC);
    if (total) total.textContent = formatUSDC(fakeTotalEarnedUSDC);
    if (today) today.textContent = formatUSDC(fakeTodayEarnedUSDC);
    if (pending) pending.textContent = formatUSDC(fakePendingUSDC);
}

// ========= 事件绑定：筛选 / 按钮 =========

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

function initEarnActions() {
    document.querySelector<HTMLButtonElement>("#btn-withdraw")?.addEventListener("click", () => {
        showToast("Withdraw request submitted (fake).");
    });

    document.querySelector<HTMLButtonElement>("#btn-earn-activity")?.addEventListener("click", () => {
        showToast("Open earn activity (fake).");
    });

    document.querySelector<HTMLButtonElement>("#btn-open-advertise")?.addEventListener("click", () => {
        window.location.href = "ad_advertise.html";
    });
}

// ========= 初始化入口 =========

function initAdPlaza() {
    renderEarnSummary();
    renderEarnAds();

    initEarnFiltersEvents();
    initEarnActions();
    updateFilterToolsUI();
}

document.addEventListener("DOMContentLoaded", () => {
    try {
        initAdPlaza();
    } catch (err) {
        console.error("Ad Plaza init error:", err);
    }
});
