import { $2, cloneTemplate, formatUSDC, getCurrentUserInfo, showNotification } from "../common";
import { logAdP } from "../../common/debug_flags";
import { x402WorkerFetch, x402WorkerGet } from "../../wallet/cdp_wallet";
import { API_PATH_ADS_CLAIM, API_PATH_ADS_LIST } from "./ad_publisher_common";
import {
    AdCategory,
    CATEGORY_DURATION,
    CATEGORY_TAGS,
    EarnAd,
    executorState,
    categoryIcon,
    getRewardRange
} from "./ad_executor_common";
import { loadEarnSummary } from "./ad_executor_summary";

const DEFAULT_SORT = "reward-high";

export async function loadAds(): Promise<void> {
    try {
        const response = await x402WorkerGet(API_PATH_ADS_LIST);
        if (!Array.isArray(response)) {
            showNotification("Invalid ads payload", "error");
            return;
        }

        executorState.earnAds = (response as EarnAd[]).map((ad) => ({
            ...ad,
            durationMinutes: ad.durationMinutes || CATEGORY_DURATION[ad.category] || 3,
            tags: ad.tags?.length ? ad.tags : (CATEGORY_TAGS[ad.category] || []),
            rewardRange: ad.rewardRange || getRewardRange(ad.rewardUSDC),
        }));
        logAdP("------>>>ad of plaza:", response)
    } catch (err) {
        console.error("Failed to load ads list:", err);
        executorState.earnAds = [];
        showNotification("Failed to load ads.", "error");
    }
}

export async function startTask(ad: EarnAd) {
    if (executorState.taskRunState[ad.id] === "running") return;
    executorState.taskRunState[ad.id] = "running";

    try {
        const { xId, walletAddress } = await getCurrentUserInfo();

        const claim = await x402WorkerFetch(API_PATH_ADS_CLAIM, {
            ad_id: ad.id,
            b_x_id: xId,
            b_wallet: walletAddress,
        });

        showNotification(`Claim created: ${claim.claim_id}`, "success");
        await loadAds();
        await loadEarnSummary();
        renderEarnAds();
    } catch (err) {
        console.error("Failed to claim ad:", err);
        showNotification((err as Error).message || "Failed to claim ad.", "error");
    } finally {
        executorState.taskRunState[ad.id] = "idle";
        renderEarnAds();
    }
}

export function renderEarnAds() {
    const grid = document.querySelector<HTMLElement>(".ad-cards-grid");
    if (!grid) return;

    const emptyState = grid.querySelector<HTMLElement>(".empty-state");
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

        const iconEl = $2<HTMLElement>(card, ".ad-card-icon");
        iconEl.textContent = categoryIcon[ad.category] || "📢";

        $2<HTMLElement>(card, ".ad-card-title").textContent = ad.title;
        $2<HTMLElement>(card, ".ad-card-brand").textContent = ad.brand;
        $2<HTMLElement>(card, ".ad-card-description").textContent = ad.description;

        $2<HTMLElement>(card, ".meta-time").textContent = `⏱️ ${ad.durationMinutes} min`;
        $2<HTMLElement>(card, ".meta-quota").textContent = `👥 ${ad.completed}/${ad.totalQuota}`;
        $2<HTMLElement>(card, ".meta-deadline").textContent = `📅 ${ad.deadlineText}`;

        $2<HTMLElement>(card, ".reward-value").textContent = formatUSDC(ad.rewardUSDC);

        const tagsContainer = $2<HTMLElement>(card, ".ad-card-tags");
        const tagTpl = $2<HTMLElement>(tagsContainer, ".tpl-tag");
        tagTpl.remove();
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

        // Check if user has already claimed this ad
        const myClaim = executorState.myClaims.find(c => c.ad_id === ad.id);
        const isClaimed = !!myClaim;

        // button
        const btn = $2<HTMLButtonElement>(card, ".btn-start-task");
        btn.disabled = isClaimed || executorState.taskRunState[ad.id] === "running" || ad.completed >= ad.totalQuota;

        if (isClaimed) {
            btn.textContent = myClaim?.status || "Claimed";
            btn.classList.add("claimed");
            card.classList.add("ad-card-claimed");
        } else {
            btn.textContent = ad.completed >= ad.totalQuota
                ? "Completed"
                : (executorState.taskRunState[ad.id] === "running" ? "Running..." : "Start Task");
        }

        btn.addEventListener("click", (ev) => {
            ev.stopPropagation();
            if (isClaimed) return;
            openDetail();
        });

        card.addEventListener("click", openDetail);
        grid.appendChild(card);
    });
}

function filterAndSortAds(): EarnAd[] {
    const categories = getSelectedCategories();
    const rewardRanges = getSelectedRewardRanges();
    const sortBy = getSortOption();
    const qstr = getSearchQuery();

    let baseAds = executorState.earnAds;
    if (executorState.currentTab === 'explore') {
        // 只看还没领过的
        baseAds = baseAds.filter(ad => !executorState.myClaims.some(c => c.ad_id === ad.id));
    } else {
        // 只看已经领过（占坑）的
        baseAds = baseAds.filter(ad => executorState.myClaims.some(c => c.ad_id === ad.id));
    }

    let result = baseAds.filter((ad) =>
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
    return select?.value || DEFAULT_SORT;
}

function getSearchQuery(): string {
    const input = document.querySelector<HTMLInputElement>("#ad-search");
    return (input?.value || "").trim().toLowerCase();
}

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

export function updateFilterToolsUI(): void {
    const clearFiltersBtn = document.querySelector<HTMLButtonElement>("#btn-clear-filters");
    if (clearFiltersBtn) clearFiltersBtn.disabled = isDefaultFilters();

    const searchInput = document.querySelector<HTMLInputElement>("#ad-search");
    const clearSearchBtn = document.querySelector<HTMLButtonElement>("#btn-clear-search");

    if (clearSearchBtn) {
        const hasText = !!(searchInput?.value || "").trim();
        clearSearchBtn.style.visibility = hasText ? "visible" : "hidden";
    }
}

function resetAllFilters(): void {
    const searchInput = document.querySelector<HTMLInputElement>("#ad-search");
    if (searchInput) searchInput.value = "";

    document.querySelectorAll<HTMLInputElement>('input[name="category"]').forEach(i => i.checked = true);
    document.querySelectorAll<HTMLInputElement>('input[name="reward"]').forEach(i => i.checked = true);

    const sort = document.querySelector<HTMLSelectElement>("#sort-select");
    if (sort) sort.value = DEFAULT_SORT;

    updateFilterToolsUI();
    renderEarnAds();
}

export function initPlazaFiltersEvents() {
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

    const searchInput = document.querySelector<HTMLInputElement>("#ad-search");
    searchInput?.addEventListener("input", onAnyFilterChanged);

    // Tab Switcher
    const tabs = document.querySelectorAll<HTMLElement>(".plaza-tab");
    tabs.forEach(tab => {
        tab.addEventListener("click", () => {
            const nextTab = tab.dataset.tab as any;
            if (executorState.currentTab === nextTab) return;

            executorState.currentTab = nextTab;
            tabs.forEach(t => t.classList.toggle("active", t === tab));
            renderEarnAds();
        });
    });

    document.querySelector<HTMLButtonElement>("#btn-clear-search")?.addEventListener("click", () => {
        if (searchInput) searchInput.value = "";
        updateFilterToolsUI();
        renderEarnAds();
        searchInput?.focus();
    });

    document.querySelector<HTMLButtonElement>("#btn-clear-filters")?.addEventListener("click", () => {
        resetAllFilters();
    });
}
