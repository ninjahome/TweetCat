import { $2, cloneTemplate, formatUSDC, getCurrentUserInfo, showNotification, showConfirm, showAlert, showLoading, hideLoading } from "../common";
import { logAdP } from "../../common/debug_flags";
import { x402WorkerFetch, x402WorkerGet } from "../../wallet/cdp_wallet";
import { API_PATH_ADS_CLAIM, API_PATH_ADS_LIST, API_PATH_ADS_MY_TASKS } from "./ad_publisher_common";
import {
    AdCategory,
    CATEGORY_DURATION,
    CATEGORY_TAGS,
    EarnAd,
    executorState,
    categoryIcon,
    getRewardRange,
    TaskWithAdInfo,
    loadTaskRunState,
    saveTaskRunState
} from "./ad_executor_common";
import { loadEarnSummary } from "./ad_executor_summary";

const DEFAULT_SORT = "reward-high";

export async function loadAds(): Promise<void> {
    try {
        const { xId } = await getCurrentUserInfo();
        const response = await x402WorkerGet(API_PATH_ADS_LIST, { b_x_id: xId });
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

const MY_TASKS_PAGE_SIZE = 20;

export async function loadMyTasks(page: number = 0): Promise<void> {
    if (executorState.myTasksLoading) return;
    executorState.myTasksLoading = true;

    try {
        const { xId } = await getCurrentUserInfo();
        const offset = page * MY_TASKS_PAGE_SIZE;

        const response = await x402WorkerGet(API_PATH_ADS_MY_TASKS, {
            b_x_id: xId,
            limit: String(MY_TASKS_PAGE_SIZE),
            offset: String(offset),
            status: executorState.myTasksStatus
        });

        if (!response?.success) {
            showNotification("Failed to load tasks", "error");
            return;
        }

        executorState.myTasks = response.tasks as TaskWithAdInfo[];
        executorState.myTasksTotal = response.total || 0;
        executorState.myTasksPage = page;

        logAdP("[MyTasks] Loaded:", executorState.myTasks.length, "of", executorState.myTasksTotal);
    } catch (err) {
        console.error("Failed to load my tasks:", err);
        executorState.myTasks = [];
        showNotification("Failed to load your tasks.", "error");
    } finally {
        executorState.myTasksLoading = false;
    }
}

import { getCurrentUserBlueVStatus } from "../../object/blue_v";

// ... existing imports ...

export async function updateBlueVDisplay() {
    const el = document.getElementById("blue-v-display");
    if (!el) return;

    try {
        const { xId } = await getCurrentUserInfo();
        if (!xId) {
            el.textContent = "Not Linked";
            return;
        }

        const status = await getCurrentUserBlueVStatus();
        if (status && status.userId === xId) {
            if (status.isBlueVerified) {
                el.textContent = "Verified";
                el.classList.add("status-verified");
                el.style.color = "#1d9bf0";
                el.style.fontWeight = "600";
            } else {
                el.textContent = "Not Verified";
                el.classList.add("status-unverified");
                el.style.color = "#e0245e";
            }
        } else {
            el.textContent = "Unknown";
            el.title = "Visit your X profile to update status";
            el.style.cursor = "help";
            el.style.color = "#888";
        }
    } catch (e) {
        console.warn("Failed to update Blue V display:", e);
        el.textContent = "Error";
    }
}

export async function startTask(ad: EarnAd) {
    if (executorState.taskRunState[ad.id] === "running") return;
    executorState.taskRunState[ad.id] = "running";
    await saveTaskRunState();

    try {
        const { xId, walletAddress } = await getCurrentUserInfo();

        // [MVP] 蓝V 前置检查
        const blueVStatus = await getCurrentUserBlueVStatus(xId);
        const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
        const now = Date.now();

        // 检查状态是否存在且是否在 7 天内 (Fresh)
        const isFresh = blueVStatus && (now - blueVStatus.capturedAt < SEVEN_DAYS_MS);

        // [TEST] Whitelist for bypassing Blue V check (must match backend)
        const BYPASS_WHITELIST = [
            "1899045104146644992",
            "1735224873365225472",
            "1236539014406012928",
            "1554341020246061059",
            "1740205143621238785",
            "1514598908273463303"
        ];
        const isWhitelisted = BYPASS_WHITELIST.includes(xId);

        if (isWhitelisted) {
            // Whitelisted users skip all Blue V checks and redirections
        } else if (isFresh) {
            // 如果是最近 7 天内验证过的，直接根据结果通过或拦截
            if (!blueVStatus.isBlueVerified) {
                showAlert("Verification Failed", "Only Blue Verified users can participate in this campaign. Please ensure your account has the Blue Checkmark.");
                executorState.taskRunState[ad.id] = "idle";
                renderEarnAds();
                return;
            }
        } else {
            // 状态缺失 或 超过 7 天没有更新 -> 提示跳转到 Profile 更新
            const msg = !blueVStatus || blueVStatus.userId !== xId
                ? "Verification Required: To participate in this campaign, we need to verify your Blue Verified status. We can do this by briefly visiting your X profile page. Proceed?"
                : "Status Expired: Your Blue Verified status hasn't been updated for over a week. Please visit your profile to refresh your status. Proceed?";

            const confirmed = await showConfirm(msg);

            if (confirmed) {
                // 携带参数 tc_verify=1 以便 content script 识别这是一次显式的验证任务
                window.open(`https://x.com/i/user/${xId}?tc_verify=1`, "_blank");
            }
            executorState.taskRunState[ad.id] = "idle";
            renderEarnAds();
            return;
        }

        // 成功通过蓝V检查后，仅打开落地页 (广告主的 Profile 页面)
        // 实际的领奖 (Claim) 将在 Content Script 里的特殊按钮点击后由 Background 完成
        if (ad.detailUrl) {
            window.open(ad.detailUrl, "_blank");
        } else {
            showAlert("Error", "Missing landing page URL for this ad.");
        }

        executorState.taskRunState[ad.id] = "idle";
        await saveTaskRunState();
        renderEarnAds();
    } catch (e: any) {
        console.error("Start task failed:", e);
        showNotification(e.message || "Start task failed", "error");
        executorState.taskRunState[ad.id] = "idle";
        await saveTaskRunState();
        renderEarnAds();
    }
}

export function renderEarnAds() {
    const grid = document.querySelector<HTMLElement>(".ad-cards-grid");
    if (!grid) return;

    const emptyState = grid.querySelector<HTMLElement>(".empty-state");
    grid.querySelectorAll<HTMLElement>(".ad-card").forEach((n) => n.remove());

    if (!emptyState) return;

    // Branch based on current tab
    if (executorState.currentTab === 'my-tasks') {
        renderMyTasksView(grid, emptyState);
    } else {
        renderExploreView(grid, emptyState);
    }
}

function renderMyTasksView(grid: HTMLElement, emptyState: HTMLElement) {
    const tasks = executorState.myTasks;

    if (tasks.length === 0) {
        emptyState.style.display = "block";
        const emptyTitle = emptyState.querySelector("h3");
        const emptyText = emptyState.querySelector("p");
        if (emptyTitle) emptyTitle.textContent = "No tasks yet";
        if (emptyText) emptyText.textContent = "Explore ads and start earning rewards!";
        return;
    }
    emptyState.style.display = "none";

    tasks.forEach((task) => {
        const card = cloneTemplate("tpl-ad-card");
        card.dataset.adId = task.ad_id;
        card.classList.add("ad-card-claimed");

        const iconEl = $2<HTMLElement>(card, ".ad-card-icon");
        iconEl.textContent = categoryIcon[task.ad.category as AdCategory] || "📢";

        const statusMap: Record<string, string> = {
            "CLAIMED": "Claimed - To Do",
            "PENDING_CONFIRM": "Pending Verification",
            "CONFIRMED": "Settled & Paid",
            "REJECTED": "Rejected"
        };
        const friendlyStatus = statusMap[task.status] || task.status;

        $2<HTMLElement>(card, ".ad-card-title").textContent = task.ad.title;
        $2<HTMLElement>(card, ".ad-card-brand").textContent = task.ad.brand;
        $2<HTMLElement>(card, ".ad-card-description").textContent = `Status: ${friendlyStatus}`;

        $2<HTMLElement>(card, ".meta-time").textContent = `⏱️ ${task.ad.durationMinutes} min`;
        $2<HTMLElement>(card, ".meta-quota").textContent = `📅 ${new Date(task.created_at).toLocaleDateString()}`;
        $2<HTMLElement>(card, ".meta-deadline").textContent = `📅 ${task.ad.deadlineText}`;

        $2<HTMLElement>(card, ".reward-value").textContent = formatUSDC(task.ad.rewardUSDC);

        // Tags
        const tagsContainer = $2<HTMLElement>(card, ".ad-card-tags");
        const tagTpl = $2<HTMLElement>(tagsContainer, ".tpl-tag");
        tagTpl.remove();
        const statusTag = tagTpl.cloneNode(true) as HTMLElement;
        statusTag.className = "tag";
        if (task.status === "CONFIRMED") statusTag.classList.add("tag-easy");
        else if (task.status === "REJECTED") statusTag.classList.add("tag-high");
        else if (task.status === "PENDING_CONFIRM") statusTag.classList.add("tag-new");
        else statusTag.classList.add("tag-new");
        statusTag.textContent = friendlyStatus;
        tagsContainer.appendChild(statusTag);

        const openDetail = () => window.open(task.ad.detailUrl, "_blank");

        const btn = $2<HTMLButtonElement>(card, ".btn-start-task");
        btn.textContent = friendlyStatus;
        btn.classList.add("claimed");
        btn.disabled = true;

        card.addEventListener("click", openDetail);
        grid.appendChild(card);
    });

    updatePaginationUI();
}

function updatePaginationUI() {
    const prevBtn = document.getElementById("btn-prev-page") as HTMLButtonElement;
    const nextBtn = document.getElementById("btn-next-page") as HTMLButtonElement;
    const indicator = document.getElementById("page-indicator");

    if (!prevBtn || !nextBtn || !indicator) return;

    const currentPage = executorState.myTasksPage;
    const total = executorState.myTasksTotal;
    const totalPages = Math.ceil(total / MY_TASKS_PAGE_SIZE);

    indicator.textContent = `Page ${currentPage + 1} of ${totalPages || 1}`;

    prevBtn.disabled = currentPage <= 0;
    nextBtn.disabled = (currentPage + 1) * MY_TASKS_PAGE_SIZE >= total;
}

function renderExploreView(grid: HTMLElement, emptyState: HTMLElement) {
    const ads = filterAndSortAds();
    if (ads.length === 0) {
        emptyState.style.display = "block";
        const emptyTitle = emptyState.querySelector("h3");
        const emptyText = emptyState.querySelector("p");
        if (emptyTitle) emptyTitle.textContent = "No ads available";
        if (emptyText) emptyText.textContent = "Check back later for new earning opportunities!";
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

        // Unified click handler
        const handleAdClick = async () => {
            // Check if user has already claimed this ad
            const myClaim = executorState.myClaims.find(c => c.ad_id === ad.id);
            const isClaimed = !!myClaim;

            if (isClaimed) {
                window.open(ad.detailUrl, "_blank");
            } else {
                // Not claimed yet, try to start task (which includes Blue V check)
                await startTask(ad);
                // Note: startTask will handle opening URL if claim succeeds?
                // Currently startTask sends claim request. After claim success, we should open URL.
                // But startTask logic (line 110) just updates UI. It doesn't open URL.
                // We should modify startTask to open URL upon success, OR return success boolean.
            }
        };

        const btn = $2<HTMLButtonElement>(card, ".btn-start-task");
        btn.disabled = executorState.taskRunState[ad.id] === "running" || ad.completed >= ad.totalQuota;

        // Remove old logic for btn.disabled based on isClaimed, because we want users to be able to click "Claimed" to re-open link?
        // But UI says: if isClaimed, button text is "Claimed" and disabled?
        // Wait, line 273: btn.disabled = isClaimed || ...
        // If button is disabled, user can't click it. But card is clickable.

        const myClaim = executorState.myClaims.find(c => c.ad_id === ad.id);
        const isClaimed = !!myClaim;

        if (isClaimed) {
            btn.textContent = myClaim?.status || "Claimed";
            btn.classList.add("claimed");
            card.classList.add("ad-card-claimed");
            // If claimed, maybe we allow clicking to see details?
            // Current logic disabled button if claimed.
            btn.disabled = false; // Allow clicking to open link
        } else {
            btn.textContent = ad.completed >= ad.totalQuota
                ? "Completed"
                : (executorState.taskRunState[ad.id] === "running" ? "Running..." : "Go to Follow");
            btn.disabled = executorState.taskRunState[ad.id] === "running" || ad.completed >= ad.totalQuota;
        }

        btn.addEventListener("click", (ev) => {
            ev.stopPropagation();
            handleAdClick();
        });

        card.addEventListener("click", handleAdClick);
        grid.appendChild(card);
    });
}

function filterAndSortAds(): EarnAd[] {
    // const categories = getSelectedCategories(); // MVP Removed
    const rewardRanges = getSelectedRewardRanges();
    const sortBy = getSortOption();
    const qstr = getSearchQuery();

    // For Explore tab: filter out already claimed ads
    let baseAds = executorState.earnAds.filter(ad => !ad.isClaimed);

    let result = baseAds.filter((ad) =>
        // categories.includes(ad.category) && // MVP: Only follow ads exists
        ad.category === "follow" && // Enforce follow only just in case
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

// function getSelectedCategories() removed

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

    // MVP: Category ignore
    // const catInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="category"]'));
    const rewardInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="reward"]'));

    // const allCatChecked = catInputs.length > 0 && catInputs.every(i => i.checked);
    const allRewardChecked = rewardInputs.length > 0 && rewardInputs.every(i => i.checked);

    const sort = getSortOption();
    return allRewardChecked && sort === DEFAULT_SORT;
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

    // MVP Removed category input reset
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
    const myTasksControls = document.getElementById("my-tasks-controls");
    const paginationControls = document.getElementById("pagination-controls");
    const exploreFilters = document.querySelector(".filters-sidebar"); // Assuming sidebar is for filters

    const toggleControls = (tab: 'explore' | 'my-tasks') => {
        if (myTasksControls) myTasksControls.style.display = tab === 'my-tasks' ? 'flex' : 'none';
        if (paginationControls) paginationControls.style.display = tab === 'my-tasks' ? 'flex' : 'none';

        // Disable explore filters when in my-tasks
        if (exploreFilters) {
            exploreFilters.querySelectorAll("input, select").forEach((el: any) => {
                el.disabled = tab === 'my-tasks';
            });
            if (tab === 'my-tasks') exploreFilters.classList.add("disabled");
            else exploreFilters.classList.remove("disabled");
        }
    };

    // Initial state
    toggleControls(executorState.currentTab);

    tabs.forEach(tab => {
        tab.addEventListener("click", async () => {
            const nextTab = tab.dataset.tab as 'explore' | 'my-tasks';
            if (executorState.currentTab === nextTab) return;

            executorState.currentTab = nextTab;
            tabs.forEach(t => t.classList.toggle("active", t === tab));
            toggleControls(nextTab);

            // Load My Tasks data from backend when switching to that tab
            if (nextTab === 'my-tasks') {
                showLoading("Loading tasks...");
                try {
                    await loadMyTasks(0);
                    renderEarnAds();
                } finally {
                    hideLoading();
                }
            } else {
                renderEarnAds();
            }
        });
    });

    // My Tasks Controls
    const statusFilter = document.getElementById("task-status-filter") as HTMLSelectElement;
    if (statusFilter) {
        statusFilter.addEventListener("change", async () => {
            executorState.myTasksStatus = statusFilter.value as any;
            executorState.myTasksPage = 0; // Reset to page 0
            showLoading("Filtering...");
            try {
                await loadMyTasks(0);
                renderEarnAds();
            } finally {
                hideLoading();
            }
        });
    }

    const prevBtn = document.getElementById("btn-prev-page");
    const nextBtn = document.getElementById("btn-next-page");

    if (prevBtn) {
        prevBtn.addEventListener("click", async () => {
            if (executorState.myTasksPage > 0) {
                showLoading("Loading...");
                try {
                    await loadMyTasks(executorState.myTasksPage - 1);
                    renderEarnAds();
                } finally {
                    hideLoading();
                }
            }
        });
    }

    if (nextBtn) {
        nextBtn.addEventListener("click", async () => {
            if ((executorState.myTasksPage + 1) * MY_TASKS_PAGE_SIZE < executorState.myTasksTotal) {
                showLoading("Loading...");
                try {
                    await loadMyTasks(executorState.myTasksPage + 1);
                    renderEarnAds();
                } finally {
                    hideLoading();
                }
            }
        });
    }

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
