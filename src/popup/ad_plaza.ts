// ad_plaza.ts
// Earn 页面：优先使用后端广告与 Claim 数据，失败时回退到假数据
// ✅ 已移除所有 document.createElement：全部改为 HTML <template> + cloneNode

// ========= 类型定义 =========

import {$2, cloneTemplate, formatUSDC, showNotification, x402WorkerFetch, x402WorkerGet, atomicToUsdcNumber} from "./common";
import {localGet, localSet} from "../common/local_storage";

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

let fakeWithdrawableUSDC = 12.34;
let fakeTotalEarnedUSDC = 23.45;
let fakeTodayEarnedUSDC = 1.25;
let fakePendingUSDC = 0.75;
let earnAds: EarnAd[] = [];

// ========= 工具函数 =========

const categoryIcon: Record<AdCategory, string> = {
    follow: "👤",
    visit: "🔗",
    register: "🧾",
    share: "🔁"
};

// 每个任务的临时状态：避免重复点击导致瞬间 +N
const taskRunState: Record<string, "idle" | "running"> = {};

interface EarnClaim {
    claim_id: string;
    ad_id: string;
    status: string;
    created_at: string;
    expires_at: string;
    unit_price_atomic: string;
    ad_title?: string;
}

const CATEGORY_DURATION: Record<AdCategory, number> = {
    follow: 2,
    visit: 3,
    register: 5,
    share: 4,
};

const CATEGORY_TAGS: Record<AdCategory, string[]> = {
    follow: ["New", "Easy"],
    visit: ["Explore"],
    register: ["High Reward"],
    share: ["Popular"],
};

function getRewardRange(rewardUSDC: number): "0.1-0.5" | "0.5-1" | "1+" {
    if (rewardUSDC < 0.5) return "0.1-0.5";
    if (rewardUSDC < 1) return "0.5-1";
    return "1+";
}

async function getBuyerIdentity(): Promise<{ bXId: string; bWallet: string; usedFallback: boolean }> {
    const storedXId = await localGet("earn_b_x_id");
    const storedWallet = await localGet("earn_b_wallet");
    if (storedXId && storedWallet) {
        return { bXId: storedXId, bWallet: storedWallet, usedFallback: false };
    }

    const fallbackId = (await localGet("earn_dev_b_x_id")) || `dev_b_${Math.random().toString(36).slice(2, 8)}`;
    const fallbackWallet = (await localGet("earn_dev_b_wallet")) || "0x000000000000000000000000000000000000dEaD";
    await localSet("earn_dev_b_x_id", fallbackId);
    await localSet("earn_dev_b_wallet", fallbackWallet);
    return { bXId: fallbackId, bWallet: fallbackWallet, usedFallback: true };
}

async function loadAds(): Promise<void> {
    try {
        const response = await x402WorkerGet("/ads/list");
        if (!Array.isArray(response)) {
            throw new Error("Invalid ads payload");
        }
        earnAds = (response as EarnAd[]).map((ad) => ({
            ...ad,
            durationMinutes: ad.durationMinutes || CATEGORY_DURATION[ad.category] || 3,
            tags: ad.tags?.length ? ad.tags : (CATEGORY_TAGS[ad.category] || []),
            rewardRange: ad.rewardRange || getRewardRange(ad.rewardUSDC),
        }));
    } catch (err) {
        console.error("Failed to load ads list:", err);
        earnAds = fakeEarnAds.slice();
        showNotification("Failed to load ads, showing demo list.", "error");
    }
}

async function startTask(ad: EarnAd) {
    if (taskRunState[ad.id] === "running") return;
    taskRunState[ad.id] = "running";

    try {
        const { bXId, bWallet, usedFallback } = await getBuyerIdentity();
        if (usedFallback) {
            showNotification("Using dev identity for claim. Please bind your account.", "error");
        }

        const claim = await x402WorkerFetch("/ads/claim", {
            ad_id: ad.id,
            b_x_id: bXId,
            b_wallet: bWallet,
        });

        showNotification(`Claim created: ${claim.claim_id}`, "success");
        await loadAds();
        renderEarnAds();
    } catch (err) {
        console.error("Failed to claim ad:", err);
        showNotification((err as Error).message || "Failed to claim ad.", "error");
    } finally {
        taskRunState[ad.id] = "idle";
        renderEarnAds();
    }
}

async function loadClaims(): Promise<EarnClaim[]> {
    const { bXId, usedFallback } = await getBuyerIdentity();
    if (usedFallback) {
        showNotification("Using dev identity for activity. Please bind your account.", "error");
    }
    const response = await x402WorkerGet("/ads/my_claims", { b_x_id: bXId });
    return Array.isArray(response) ? (response as EarnClaim[]) : [];
}

function formatClaimTime(value?: string): string {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString();
}

function renderActivityList(claims: EarnClaim[]) {
    const list = document.querySelector<HTMLElement>("#earn-activity-list");
    if (!list) return;
    list.innerHTML = "";

    if (claims.length === 0) {
        list.innerHTML = `<div class="activity-empty">No activity yet.</div>`;
        return;
    }

    claims.forEach((claim) => {
        const item = cloneTemplate("tpl-activity-item");
        $2<HTMLElement>(item, ".activity-title").textContent = claim.ad_title || claim.ad_id;
        $2<HTMLElement>(item, ".activity-status").textContent = claim.status;
        $2<HTMLElement>(item, ".activity-meta").textContent = `Created: ${formatClaimTime(claim.created_at)} · Expires: ${formatClaimTime(claim.expires_at)}`;
        $2<HTMLElement>(item, ".activity-reward").textContent = formatUSDC(atomicToUsdcNumber(claim.unit_price_atomic));
        list.appendChild(item);
    });
}

function toggleActivityModal(open: boolean) {
    const modal = document.querySelector<HTMLElement>("#earn-activity-modal");
    if (!modal) return;
    modal.classList.toggle("active", open);
}


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

    let result = (earnAds.length > 0 ? earnAds : fakeEarnAds).filter((ad) =>
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
        const iconEl = $2<HTMLElement>(card, ".ad-card-icon");
        iconEl.textContent = categoryIcon[ad.category] || "📢";

        // text fields
        $2<HTMLElement>(card, ".ad-card-title").textContent = ad.title;
        $2<HTMLElement>(card, ".ad-card-brand").textContent = ad.brand;
        $2<HTMLElement>(card, ".ad-card-description").textContent = ad.description;

        $2<HTMLElement>(card, ".meta-time").textContent = `⏱️ ${ad.durationMinutes} min`;
        $2<HTMLElement>(card, ".meta-quota").textContent = `👥 ${ad.completed}/${ad.totalQuota}`;
        $2<HTMLElement>(card, ".meta-deadline").textContent = `📅 ${ad.deadlineText}`;

        $2<HTMLElement>(card, ".reward-value").textContent = formatUSDC(ad.rewardUSDC);

        // tags
        const tagsContainer = $2<HTMLElement>(card, ".ad-card-tags");
        const tagTpl = $2<HTMLElement>(tagsContainer, ".tpl-tag");
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
        const btn = $2<HTMLButtonElement>(card, ".btn-start-task");
        btn.disabled = taskRunState[ad.id] === "running" || ad.completed >= ad.totalQuota;
        btn.textContent = ad.completed >= ad.totalQuota
            ? "Completed"
            : (taskRunState[ad.id] === "running" ? "Running..." : "Start Task");

        btn.addEventListener("click", (ev) => {
            ev.stopPropagation();
            // 不改变你的 openDetail 逻辑，你可以决定要不要打开详情
            // openDetail();

            startTask(ad).catch((err) => {
                console.error("Start task error:", err);
            });
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
        if (fakeWithdrawableUSDC <= 0) {
            showNotification("Nothing to withdraw (fake).");
            return;
        }

        const amount = fakeWithdrawableUSDC;
        fakeWithdrawableUSDC = 0;

        renderEarnSummary();
        showNotification(`Withdraw submitted (fake): ${formatUSDC(amount)}`);
    });

    document.querySelector<HTMLButtonElement>("#btn-earn-activity")?.addEventListener("click", () => {
        toggleActivityModal(true);
        loadClaims()
            .then(renderActivityList)
            .catch((err) => {
                console.error("Load claims failed:", err);
                showNotification((err as Error).message || "Failed to load activity.", "error");
            });
    });

    document.querySelector<HTMLButtonElement>("#earn-activity-modal .btn-close")?.addEventListener("click", () => {
        toggleActivityModal(false);
    });

    document.querySelector<HTMLElement>("#earn-activity-modal")?.addEventListener("click", (ev) => {
        if ((ev.target as HTMLElement).id === "earn-activity-modal") {
            toggleActivityModal(false);
        }
    });

    document.querySelector<HTMLButtonElement>("#btn-open-advertise")?.addEventListener("click", () => {
        window.location.href = "ad_advertise.html";
    });
}

// ========= 初始化入口 =========

async function initAdPlaza() {
    await loadAds();
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
