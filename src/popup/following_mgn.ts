import browser from "webextension-polyfill";
import {MsgType} from "../common/consts";
import {__tableCategory, checkAndInitDatabase, databaseAddItem} from "../common/database";
import {
    Category,
    assignKolsToCategoryFromBG,
    queryAllKolCategoryMapFromBG,
    queryCategoriesFromBG,
    removeCategory,
    removeKolsFromCategoryFromBG,
    updateCategoryDetail,
} from "../object/category";
import {FollowingUser} from "../object/following";
import {logFM} from "../common/debug_flags";

const ALL_FILTER = "all" as const;
const UNCATEGORIZED_FILTER = "uncategorized" as const;
type CategoryFilter = typeof ALL_FILTER | typeof UNCATEGORIZED_FILTER | number;

type UnifiedKOL = {
    key: string;
    screenName?: string;
    displayName?: string;
    userId?: string;
    avatarUrl?: string;
    categoryId?: number | null;
    categoryName?: string | null;
    bio?: string;
    location?: string;
    followersCount?: number;
    friendsCount?: number;
    statusesCount?: number;
    sources: Array<"following" | "kic">;
};

type UnifiedKOLView = {
    categories: Category[];
    unified: UnifiedKOL[];
    byCategory: Map<number, UnifiedKOL[]>;
    uncategorized: UnifiedKOL[];
};

type KolSnapshot = {
    kolName: string;
    displayName?: string;
    avatarUrl?: string;
    kolUserId?: string;
};

let categories: Category[] = [];
let unifiedView: UnifiedKOLView | null = null;
let unifiedKols: UnifiedKOL[] = [];
let unifiedByKey = new Map<string, UnifiedKOL>();
let selectedFilter: CategoryFilter = ALL_FILTER;
const selectedKeys = new Set<string>();

const numberFormatter = new Intl.NumberFormat();

function setTextContentOrHide(element: HTMLElement | null, text?: string | null) {
    if (!element) return;
    const trimmed = typeof text === "string" ? text.trim() : "";
    if (trimmed) {
        element.textContent = trimmed;
        element.classList.remove("hidden");
    } else {
        element.textContent = "";
        element.classList.add("hidden");
    }
}

function formatStat(value: number | undefined, label: string): string | null {
    if (typeof value !== "number" || Number.isNaN(value)) {
        return null;
    }
    return `${numberFormatter.format(value)} ${label}`;
}

const categoryList = document.getElementById("category-list") as HTMLUListElement;
const userList = document.getElementById("user-list") as HTMLDivElement;
const emptyState = document.getElementById("empty-state") as HTMLDivElement;
const noUsersMessage = document.getElementById("no-users-message") as HTMLDivElement;
const syncButtons = [
    document.getElementById("sync-btn") as HTMLButtonElement,
    document.getElementById("empty-sync-btn") as HTMLButtonElement,
];
const syncStatus = document.getElementById("sync-status") as HTMLSpanElement;
const assignSelect = document.getElementById("assign-category-select") as HTMLSelectElement;
const assignBtn = document.getElementById("assign-category-btn") as HTMLButtonElement;
const clearSelectionBtn = document.getElementById("clear-selection-btn") as HTMLButtonElement;
const unfollowSelectedBtn = document.getElementById("unfollow-selected-btn") as HTMLButtonElement | null;
const toolbar = document.getElementById("toolbar") as HTMLDivElement;
const selectionCounter = document.getElementById("selection-counter") as HTMLSpanElement;
const categoryTemplate = document.getElementById("category-item-template") as HTMLTemplateElement;
const userTemplate = document.getElementById("user-card-template") as HTMLTemplateElement;
const newCategoryBtn = document.getElementById("btn-new-category") as HTMLButtonElement;
const notificationBar = document.getElementById("notification") as HTMLDivElement | null;
const addCategoryModal = document.getElementById("modal-add-category") as HTMLDivElement | null;
const newCategoryInput = document.getElementById("new-category-input") as HTMLInputElement | null;
const confirmNewCategoryBtn = document.getElementById("btn-confirm-new-category") as HTMLButtonElement | null;
const cancelNewCategoryBtn = document.getElementById("btn-cancel-new-category") as HTMLButtonElement | null;
const confirmModal = document.getElementById("modal-confirm") as HTMLDivElement | null;
const confirmMessage = document.getElementById("confirm-message") as HTMLParagraphElement | null;
const cancelConfirmBtn = document.getElementById("btn-cancel-confirm") as HTMLButtonElement | null;
const confirmConfirmBtn = document.getElementById("btn-confirm-confirm") as HTMLButtonElement | null;
const processingOverlay = document.getElementById("unfollow-processing-overlay") as HTMLDivElement | null;

type ConfirmCallback = () => void | Promise<void>;

let activeModal: HTMLElement | null = null;
let pendingConfirmHandler: ConfirmCallback | null = null;
let notificationTimer: number | null = null;
let isProcessingUnfollow = false;

document.addEventListener("DOMContentLoaded", initFollowingManager as EventListener);

async function initFollowingManager() {
    await checkAndInitDatabase();
    bindEvents();
    await refreshData();
}

function bindEvents() {
    syncButtons.forEach((btn) => {
        if (!btn) return;
        btn.addEventListener("click", handleSyncClick);
    });
    assignBtn.addEventListener("click", handleAssignCategory);
    clearSelectionBtn.addEventListener("click", () => {
        selectedKeys.clear();
        renderUserList();
    });
    unfollowSelectedBtn?.addEventListener("click", handleUnfollowSelected);
    newCategoryBtn?.addEventListener("click", showAddCategoryModal);

    cancelNewCategoryBtn?.addEventListener("click", hideAddCategoryModal);
    confirmNewCategoryBtn?.addEventListener("click", () => {
        void handleAddCategoryConfirm();
    });
    newCategoryInput?.addEventListener("input", handleAddCategoryInputChange);
    newCategoryInput?.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            void handleAddCategoryConfirm();
        }
    });
    addCategoryModal?.addEventListener("click", (event) => {
        if (event.target === addCategoryModal) {
            hideAddCategoryModal();
        }
    });

    cancelConfirmBtn?.addEventListener("click", hideConfirmModal);
    confirmConfirmBtn?.addEventListener("click", () => {
        void handleConfirmModalConfirm();
    });
    confirmModal?.addEventListener("click", (event) => {
        if (event.target === confirmModal) {
            hideConfirmModal();
        }
    });

    document.addEventListener("keydown", handleGlobalKeydown);
}

function showNotification(message: string, type: "info" | "error" = "info", duration = 4000) {
    if (!notificationBar) return;
    notificationBar.textContent = message;
    notificationBar.classList.remove("hidden", "info", "error");
    notificationBar.classList.add(type);
    if (notificationTimer) {
        window.clearTimeout(notificationTimer);
        notificationTimer = null;
    }
    if (duration > 0 && message) {
        notificationTimer = window.setTimeout(() => {
            hideNotification();
        }, duration);
    }
}

function hideNotification() {
    if (!notificationBar) return;
    notificationBar.textContent = "";
    notificationBar.classList.add("hidden");
    notificationBar.classList.remove("info", "error");
    if (notificationTimer) {
        window.clearTimeout(notificationTimer);
        notificationTimer = null;
    }
}

function openModal(modal: HTMLElement | null) {
    if (!modal) return;
    modal.classList.remove("hidden");
    document.body.classList.add("modal-open");
    activeModal = modal;
}

function closeModal(modal: HTMLElement | null) {
    if (!modal) return;
    modal.classList.add("hidden");
    if (activeModal === modal) {
        activeModal = null;
    }
    if (!document.querySelector(".modal:not(.hidden)")) {
        document.body.classList.remove("modal-open");
    }
}

function handleGlobalKeydown(event: KeyboardEvent) {
    if (event.key !== "Escape" || !activeModal) {
        return;
    }
    event.preventDefault();
    if (activeModal === addCategoryModal) {
        hideAddCategoryModal();
    } else if (activeModal === confirmModal) {
        hideConfirmModal();
    }
}

function handleAddCategoryInputChange() {
    if (!newCategoryInput || !confirmNewCategoryBtn) return;
    const hasValue = newCategoryInput.value.trim().length > 0;
    confirmNewCategoryBtn.disabled = !hasValue;
}

function resetAddCategoryModal() {
    if (!newCategoryInput || !confirmNewCategoryBtn) return;
    newCategoryInput.value = "";
    confirmNewCategoryBtn.disabled = true;
}

function showAddCategoryModal() {
    resetAddCategoryModal();
    openModal(addCategoryModal);
    window.setTimeout(() => {
        newCategoryInput?.focus();
    }, 0);
}

function hideAddCategoryModal() {
    resetAddCategoryModal();
    closeModal(addCategoryModal);
}

async function handleAddCategoryConfirm() {
    if (!newCategoryInput || !confirmNewCategoryBtn) return;
    const name = newCategoryInput.value.trim();
    if (!name) return;
    confirmNewCategoryBtn.disabled = true;
    try {
        await addNewCategory(name);
        hideAddCategoryModal();
    } catch (error) {
        console.warn("------>>> add category failed", error);
        confirmNewCategoryBtn.disabled = newCategoryInput.value.trim().length === 0;
        confirmNewCategoryBtn.focus();
    }
}

function hideConfirmModal() {
    pendingConfirmHandler = null;
    closeModal(confirmModal);
}

function determineConfirmLabel(message: string): string {
    const lower = message.toLowerCase();
    if (lower.includes("delete")) {
        return "Delete";
    }
    if (lower.includes("remove")) {
        return "Yes, Remove";
    }
    return "Confirm";
}

function showConfirmModal(message: string, onConfirm: ConfirmCallback) {
    if (!confirmModal || !confirmMessage || !confirmConfirmBtn) return;
    confirmMessage.textContent = message;
    confirmConfirmBtn.textContent = determineConfirmLabel(message);
    pendingConfirmHandler = onConfirm;
    openModal(confirmModal);
    window.setTimeout(() => {
        confirmConfirmBtn.focus();
    }, 0);
}

async function handleConfirmModalConfirm() {
    if (!pendingConfirmHandler) {
        hideConfirmModal();
        return;
    }
    const handler = pendingConfirmHandler;
    pendingConfirmHandler = null;
    try {
        await handler();
    } catch (error) {
        const err = error as Error;
        showNotification(err?.message ?? "Operation failed.", "error");
    } finally {
        hideConfirmModal();
    }
}

async function refreshData() {
    const view = await buildUnifiedKOLView();
    applyUnifiedView(view);
    renderAll();
}

function applyUnifiedView(view: UnifiedKOLView) {
    unifiedView = view;
    categories = view.categories;
    unifiedKols = view.unified;
    unifiedByKey = new Map(view.unified.map((item) => [item.key, item]));
    Array.from(selectedKeys).forEach((key) => {
        if (!unifiedByKey.has(key)) {
            selectedKeys.delete(key);
        }
    });
    updateSelectionSummary();
}

async function fetchFollowings(): Promise<FollowingUser[]> {
    try {
        const rsp = await browser.runtime.sendMessage({action: MsgType.FollowingQueryAll});
        if (!rsp?.success) {
            console.warn("------>>> failed to query followings:", rsp?.data);
            return [];
        }
        return (rsp.data as FollowingUser[]) ?? [];
    } catch (error) {
        console.warn("------>>> failed to load followings", error);
        return [];
    }
}

function renderAll() {
    renderCategoryList();
    renderAssignSelect();
    renderUserList();
    updateEmptyState();
}

function renderCategoryList() {
    categoryList.innerHTML = "";

    const counts = buildCategoryCountMap();

    const allItem = createCategoryElement(ALL_FILTER, `All (${counts.total})`, true, counts);
    categoryList.appendChild(allItem);

    const uncategorizedLabel = `Unassigned (${counts.uncategorized})`;
    const uncategorizedItem = createCategoryElement(UNCATEGORIZED_FILTER, uncategorizedLabel, true, counts);
    categoryList.appendChild(uncategorizedItem);

    categories
        .slice()
        .sort((a, b) => a.id! - b.id!)
        .forEach((cat) => {
            const label = `${cat.catName} (${counts.perCategory.get(cat.id!) ?? 0})`;
            const node = createCategoryElement(cat.id!, label, false, counts, cat);
            categoryList.appendChild(node);
        });

    highlightCurrentFilter();
}

function createCategoryElement(
    filter: CategoryFilter,
    label: string,
    isBuiltin: boolean,
    counts: ReturnType<typeof buildCategoryCountMap>,
    category?: Category,
): HTMLElement {
    if (isBuiltin) {
        const li = document.createElement("li");
        li.className = "category-item";
        li.dataset.filter = String(filter);
        li.textContent = label;
        li.addEventListener("click", () => {
            selectedFilter = filter;
            highlightCurrentFilter();
            renderUserList();
        });
        return li;
    }

    const li = categoryTemplate.content.firstElementChild!.cloneNode(true) as HTMLElement;
    li.dataset.filter = String(filter);
    li.querySelector(".category-name")!.textContent = category?.catName ?? label;
    li.querySelector(".category-count")!.textContent = `${counts.perCategory.get(filter as number) ?? 0}`;

    const selectHandler = () => {
        selectedFilter = filter;
        highlightCurrentFilter();
        renderUserList();
    };
    li.addEventListener("click", selectHandler);

    const renameBtn = li.querySelector<HTMLButtonElement>(".rename-btn, .edit-btn");
    renameBtn?.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (!category) return;
        handleRenameCategory(category).then();
    });

    const deleteBtn = li.querySelector(".delete-btn") as HTMLButtonElement;
    deleteBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (!category) return;
        handleDeleteCategory(category);
    });

    return li;
}

function highlightCurrentFilter() {
    Array.from(categoryList.querySelectorAll<HTMLElement>(".category-item")).forEach((item) => {
        const filterValue = parseFilterValue(item.dataset.filter);
        if (filterValue === selectedFilter) {
            item.classList.add("active");
        } else {
            item.classList.remove("active");
        }
    });
}

function parseFilterValue(value?: string): CategoryFilter {
    if (!value) return ALL_FILTER;
    if (value === ALL_FILTER) return ALL_FILTER;
    if (value === UNCATEGORIZED_FILTER) return UNCATEGORIZED_FILTER;
    return Number(value);
}

function buildCategoryCountMap(): {
    total: number;
    uncategorized: number;
    perCategory: Map<number, number>;
} {
    const counts = new Map<number, number>();
    let uncategorized = unifiedView?.uncategorized.length ?? 0;
    if (unifiedView) {
        for (const [catId, list] of unifiedView.byCategory.entries()) {
            counts.set(catId, list.length);
        }
    }
    return {
        total: unifiedKols.length,
        uncategorized,
        perCategory: counts,
    };
}

function renderAssignSelect() {
    assignSelect.innerHTML = "";
    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = "Assign to category…";
    assignSelect.appendChild(defaultOption);

    const removeOption = document.createElement("option");
    removeOption.value = UNCATEGORIZED_FILTER;
    removeOption.textContent = "Remove from category";
    assignSelect.appendChild(removeOption);

    categories
        .slice()
        .sort((a, b) => a.id! - b.id!)
        .forEach((cat) => {
            const option = document.createElement("option");
            option.value = String(cat.id);
            option.textContent = cat.catName;
            assignSelect.appendChild(option);
        });
}

function renderUserList() {
    userList.innerHTML = "";
    const filtered = getFilteredUsers();

    if (filtered.length === 0) {
        noUsersMessage.style.display = unifiedKols.length === 0 ? "none" : "block";
    } else {
        noUsersMessage.style.display = "none";
    }

    filtered
        .slice()
        .sort((a, b) => {
            const nameA = (a.displayName ?? a.screenName ?? a.key).toLowerCase();
            const nameB = (b.displayName ?? b.screenName ?? b.key).toLowerCase();
            return nameA.localeCompare(nameB);
        })
        .forEach((user) => {
            const card = userTemplate.content.firstElementChild!.cloneNode(true) as HTMLElement;
            const checkbox = card.querySelector(".user-select") as HTMLInputElement;
            checkbox.dataset.key = user.key;
            checkbox.checked = selectedKeys.has(user.key);
            checkbox.addEventListener("change", () => toggleUserSelection(user.key, checkbox.checked));

            const avatar = card.querySelector(".user-avatar") as HTMLImageElement;
            avatar.src = user.avatarUrl || "../images/logo_48.png";
            avatar.alt = `${user.displayName ?? user.screenName ?? user.key}'s avatar`;

            const nameElm = card.querySelector(".name") as HTMLElement;
            nameElm.textContent = user.displayName ?? user.screenName ?? user.key;

            const handleElm = card.querySelector(".handle") as HTMLElement;
            handleElm.textContent = user.screenName ? `@${user.screenName}` : "";

            const categoryElm = card.querySelector(".category-badge") as HTMLElement | null;
            if (categoryElm) {
                if (selectedFilter === ALL_FILTER && user.categoryName) {
                    categoryElm.textContent = user.categoryName;
                    categoryElm.classList.remove("hidden");
                } else {
                    categoryElm.textContent = "";
                    categoryElm.classList.add("hidden");
                }
            }

            const bioElm = card.querySelector(".bio") as HTMLElement | null;
            setTextContentOrHide(bioElm, user.bio);

            const locationElm = card.querySelector(".location") as HTMLElement | null;
            const locationText = user.location ? `📍 ${user.location}` : undefined;
            setTextContentOrHide(locationElm, locationText);

            const statsElm = card.querySelector(".stats") as HTMLElement | null;
            if (statsElm) {
                const statsParts = [
                    formatStat(user.followersCount, "Followers"),
                    formatStat(user.friendsCount, "Following"),
                    formatStat(user.statusesCount, "Tweets"),
                ].filter((part): part is string => typeof part === "string" && part.length > 0);
                if (statsParts.length > 0) {
                    statsElm.textContent = statsParts.join(" • ");
                    statsElm.classList.remove("hidden");
                } else {
                    statsElm.textContent = "";
                    statsElm.classList.add("hidden");
                }
            }

            const metaElm = card.querySelector(".meta") as HTMLElement | null;
            if (metaElm) {
                const hasLocation = locationElm ? !locationElm.classList.contains("hidden") : false;
                const hasStats = statsElm ? !statsElm.classList.contains("hidden") : false;
                if (!hasLocation && !hasStats) {
                    metaElm.classList.add("hidden");
                } else {
                    metaElm.classList.remove("hidden");
                }
            }

            card.addEventListener("click", (ev) => {
                if (ev.target instanceof HTMLInputElement) return;
                checkbox.checked = !checkbox.checked;
                toggleUserSelection(user.key, checkbox.checked);
            });

            card.classList.add(user.sources.includes("following") ? "is-following" : "is-local-only");
            userList.appendChild(card);
        });

    updateSelectionSummary();
}

function getFilteredUsers(): UnifiedKOL[] {
    if (!unifiedView) {
        return [];
    }
    if (selectedFilter === ALL_FILTER) {
        return unifiedKols;
    }
    if (selectedFilter === UNCATEGORIZED_FILTER) {
        return unifiedView.uncategorized;
    }
    return unifiedView.byCategory.get(selectedFilter) ?? [];
}

function toggleUserSelection(key: string, selected: boolean) {
    if (selected) {
        selectedKeys.add(key);
    } else {
        selectedKeys.delete(key);
    }
    updateSelectionSummary();
}

function updateSelectionSummary() {
    const count = selectedKeys.size;
    selectionCounter.textContent = `${count} selected`;
    assignBtn.disabled = isProcessingUnfollow || count === 0;
    clearSelectionBtn.disabled = isProcessingUnfollow || count === 0;
    if (unfollowSelectedBtn) {
        unfollowSelectedBtn.disabled = isProcessingUnfollow || count === 0;
    }
}

function updateEmptyState() {
    const hasData = unifiedKols.length > 0;
    emptyState.style.display = hasData ? "none" : "flex";
    toolbar.style.display = hasData ? "flex" : "none";
    userList.style.display = hasData ? "grid" : "none";
    if (!hasData) {
        selectedKeys.clear();
        updateSelectionSummary();
    }
}

async function handleSyncClick() {
    setSyncLoading(true);
    try {
        const rsp = await browser.runtime.sendMessage({action: MsgType.FollowingSync});
        if (!rsp?.success) {
            const message = typeof rsp?.data === "string" ? rsp.data : "Failed to sync followings.";
            showNotification(message, "error");
            return;
        }
        const count = rsp?.data?.count ?? 0;
        syncStatus.textContent = `Synced ${count} followings.`;
        selectedKeys.clear();
        await refreshData();
    } catch (error) {
        const err = error as Error;
        showNotification(err.message ?? "Failed to sync followings.", "error");
    } finally {
        setSyncLoading(false);
    }
}

function setSyncLoading(loading: boolean) {
    syncButtons.forEach((btn) => {
        if (!btn) return;
        btn.disabled = loading;
        btn.textContent = loading ? "Syncing…" : "Sync Followings";
    });
    if (loading) {
        syncStatus.textContent = "Syncing followings…";
    } else if (unifiedKols.length === 0) {
        syncStatus.textContent = "";
    }
}

type UnfollowTarget = { key: string; userId: string };

function getUnfollowTargets(): UnfollowTarget[] {
    const targets: UnfollowTarget[] = [];

    selectedKeys.forEach((key) => {
        const user = unifiedByKey.get(key);
        if (!user) return;

        if (user.sources.includes("following") && user.userId) {
            targets.push({key, userId: user.userId});
        }
    });

    return targets;
}


function handleUnfollowSelected() {
    const targets = getUnfollowTargets();
    if (targets.length === 0) {
        showNotification("No real followings to unfollow.", "info");
        return;
    }
    const message =
        targets.length === 1
            ? "Unfollow the selected account?"
            : `Unfollow ${targets.length} selected accounts?`;
    showConfirmModal(message, async () => {
        await performBatchUnfollow(targets);
    });
}

function showProcessingOverlay() {
    if (!processingOverlay) return;
    processingOverlay.classList.remove("hidden");
    document.body.classList.add("processing-blocked");
}

function hideProcessingOverlay() {
    if (!processingOverlay) return;
    processingOverlay.classList.add("hidden");
    document.body.classList.remove("processing-blocked");
}

const UNFOLLOW_REQUEST_DELAY_MS = 1100;

async function performBatchUnfollow(targets: UnfollowTarget[]) {
    if (targets.length === 0) return;
    isProcessingUnfollow = true;
    updateSelectionSummary();
    showProcessingOverlay();

    try {
        const userIds = Array.from(
            new Set(
                targets
                    .map((target) => target.userId?.trim())
                    .filter((userId): userId is string => Boolean(userId)),
            ),
        );

        if (userIds.length === 0) {
            showNotification("No valid accounts to unfollow.", "error");
            return;
        }

        const response = await browser.runtime.sendMessage({
            action: MsgType.FollowingBulkUnfollow,
            type: MsgType.FollowingBulkUnfollow,
            payload: {
                userIds,
                throttleMs: UNFOLLOW_REQUEST_DELAY_MS,
            },
        });

        if (!response) {
            showNotification("No response from background script. Please try again.", "error");
            return;
        }

        if (response?.success === false) {
            const message = typeof response?.data === "string" ? response.data : response?.error;
            showNotification(message || "Failed to unfollow selected accounts.", "error");
            return;
        }

        const result = (response?.data ?? response) as {
            total?: number;
            succeeded?: number;
            failed?: number;
        };

        const total = typeof result?.total === "number" ? result.total : userIds.length;
        const successCount = typeof result?.succeeded === "number" ? result.succeeded : 0;
        const failureCount = typeof result?.failed === "number" ? result.failed : Math.max(0, total - successCount);

        logFM("------>>> performBatchUnfollow completed, removing unfollowed users locally...");


        selectedKeys.clear();
        await removeUnfollowedFromView(userIds)

        logFM("------>>> local unfollow cache updated, skip refreshData()");

        if (failureCount === 0) {
            showNotification(
                `Unfollowed ${successCount} account${successCount === 1 ? "" : "s"}.`,
                "info",
            );
        } else if (successCount === 0) {
            showNotification("Failed to unfollow selected accounts.", "error");
        } else {
            showNotification(
                `Unfollowed ${successCount} account${successCount === 1 ? "" : "s"}. ${failureCount} failed.`,
                "error",
            );
        }
    } catch (error) {
        const err = error as Error;
        showNotification(err?.message ?? "Failed to unfollow selected accounts.", "error");
    } finally {
        isProcessingUnfollow = false;
        hideProcessingOverlay();
        updateSelectionSummary();
    }
}

function handleAssignCategory() {
    const keys = Array.from(selectedKeys);
    if (keys.length === 0) return;
    const value = assignSelect.value;
    if (value === "") return;
    const categoryId = value === UNCATEGORIZED_FILTER ? null : Number(value);
    if (categoryId !== null && Number.isNaN(categoryId)) {
        showNotification("Please select a valid category.", "error");
        return;
    }

    const handler = async () => {
        await applyCategoryAssignment(keys, categoryId);
    };

    if (categoryId === null) {
        showConfirmModal("Remove selected KOLs from this category?", handler);
    } else {
        void handler();
    }
}

async function applyCategoryAssignment(keys: string[], categoryId: number | null) {
    try {
        await bulkAssignCategory(keys, categoryId);
        selectedKeys.clear();
        assignSelect.value = "";
        await refreshData();
        const message =
            categoryId === null
                ? "Removed selected KOLs from this category."
                : "Assigned selected KOLs to the selected category.";
        showNotification(message, "info");
    } catch (error) {
        const err = error as Error;
        showNotification(err?.message ?? "Failed to update category assignment.", "error");
    }
}

async function addNewCategory(name: string) {
    const trimmed = name.trim();
    if (!trimmed) {
        showNotification("Category name cannot be empty.", "error");
        throw new Error("Category name cannot be empty.");
    }
    const category = new Category(trimmed);
    delete category.id;
    try {
        const id = await databaseAddItem(__tableCategory, category);
        category.id = Number(id);
        categories.push(category);
        renderCategoryList();
        renderAssignSelect();
        showNotification(`Created category "${category.catName}".`, "info");
    } catch (error) {
        console.warn("------>>> add category failed", error);
        showNotification("Failed to create category.", "error");
        throw error;
    }
}

async function handleRenameCategory(category: Category) {
    const name = prompt("Rename category", category.catName);
    if (!name) return;
    const trimmed = name.trim();
    if (!trimmed) {
        showNotification("Category name cannot be empty.", "error");
        return;
    }
    category.catName = trimmed;
    try {
        await updateCategoryDetail(category);
        categories = categories.map((cat) => (cat.id === category.id ? category : cat));
        renderCategoryList();
        renderAssignSelect();
        showNotification(`Renamed category to "${category.catName}".`, "info");
    } catch (error) {
        console.warn("------>>> rename category failed", error);
        showNotification("Failed to rename category.", "error");
    }
}

function handleDeleteCategory(category: Category) {
    showConfirmModal(`Delete category "${category.catName}"?`, async () => {
        try {
            await removeCategory(category.id!);
            if (selectedFilter === category.id) {
                selectedFilter = ALL_FILTER;
            }
            selectedKeys.clear();
            await refreshData();
            showNotification("Category deleted.", "info");
        } catch (error) {
            console.warn("------>>> delete category failed", error);
            showNotification("Failed to delete category.", "error");
        }
    });
}

async function buildUnifiedKOLView(): Promise<UnifiedKOLView> {
    const [categoryList, followingsList, kolMap] = await Promise.all([
        queryCategoriesFromBG(),
        fetchFollowings(),
        queryAllKolCategoryMapFromBG(),
    ]);

    const normalizeCategoryId = (value: unknown): number | null => {
        if (typeof value === "number" && Number.isFinite(value)) {
            return value;
        }
        if (typeof value === "string" && value.trim().length > 0) {
            const parsed = Number(value);
            if (Number.isFinite(parsed)) {
                return parsed;
            }
        }
        return null;
    };

    const categoryNameMap = new Map<number, string>();
    for (const category of categoryList) {
        if (typeof category.id === "number") {
            categoryNameMap.set(category.id, category.catName);
        }
    }
    const resolveCategoryName = (id: number | null | undefined) =>
        typeof id === "number" ? categoryNameMap.get(id) ?? null : null;

    const unifiedMap = new Map<string, UnifiedKOL>();

    for (const user of followingsList) {
        const screenName = user.screenName;
        if (!screenName) {
            continue;
        }
        const key = screenName.toLowerCase();
        const kicEntry = kolMap.get(key);
        const initialCategoryId = normalizeCategoryId(user.categoryId);
        const initialCategoryName = resolveCategoryName(initialCategoryId);
        const unified: UnifiedKOL = {
            key,
            screenName,
            displayName: user.name ?? screenName,
            userId: user.id,
            avatarUrl: user.avatarUrl,
            categoryId: initialCategoryId,
            categoryName: initialCategoryName,
            bio: user.bio,
            location: user.location,
            followersCount: user.followersCount,
            friendsCount: user.friendsCount,
            statusesCount: user.statusesCount,
            sources: kicEntry ? ["following", "kic"] : ["following"],
        };
        if (kicEntry) {
            unified.displayName = kicEntry.displayName ?? unified.displayName;
            unified.avatarUrl = kicEntry.avatarUrl ?? unified.avatarUrl;
            if (kicEntry.kolUserId && !unified.userId) {
                unified.userId = kicEntry.kolUserId;
            }
            const kolCategoryId = normalizeCategoryId(kicEntry.catID);
            unified.categoryId = kolCategoryId;
            unified.categoryName = resolveCategoryName(kolCategoryId);
        }
        unifiedMap.set(key, unified);
    }

    for (const [key, kol] of kolMap.entries()) {
        const existing = unifiedMap.get(key);
        if (existing) {
            const kolCategoryId = normalizeCategoryId(kol.catID);
            existing.categoryId = kolCategoryId;
            existing.categoryName = resolveCategoryName(kolCategoryId);
            if (!existing.sources.includes("kic")) {
                existing.sources.push("kic");
            }
            if (!existing.displayName) {
                existing.displayName = kol.displayName ?? kol.kolName ?? key;
            }
            if (!existing.screenName) {
                existing.screenName = kol.kolName ?? key;
            }
            if (!existing.avatarUrl && kol.avatarUrl) {
                existing.avatarUrl = kol.avatarUrl;
            }
            if (!existing.userId && kol.kolUserId) {
                existing.userId = kol.kolUserId;
            }
            continue;
        }

        const screenName = kol.kolName ?? key;
        const kolCategoryId = normalizeCategoryId(kol.catID);
        unifiedMap.set(key, {
            key,
            screenName,
            displayName: kol.displayName ?? screenName,
            userId: kol.kolUserId,
            avatarUrl: kol.avatarUrl,
            categoryId: kolCategoryId,
            categoryName: resolveCategoryName(kolCategoryId),
            sources: ["kic"],
        });
    }

    const unified = Array.from(unifiedMap.values());
    const byCategory = new Map<number, UnifiedKOL[]>();
    const uncategorized: UnifiedKOL[] = [];

    for (const item of unified) {
        if (typeof item.categoryId === "number") {
            const list = byCategory.get(item.categoryId) ?? [];
            list.push(item);
            byCategory.set(item.categoryId, list);
        } else {
            uncategorized.push(item);
        }
    }

    return {
        categories: categoryList,
        unified,
        byCategory,
        uncategorized,
    };
}

async function bulkAssignCategory(keys: string[], targetCatId: number | null): Promise<void> {
    const uniqueKeys = Array.from(new Set(keys.map((key) => key.toLowerCase())));
    const snapshots = new Map<string, KolSnapshot>();
    const entries: UnifiedKOL[] = [];

    for (const key of uniqueKeys) {
        const entry = unifiedByKey.get(key);
        if (!entry) continue;
        entries.push(entry);
        const kolName = entry.screenName ?? entry.displayName ?? key;
        snapshots.set(key, {
            kolName,
            displayName: entry.displayName ?? entry.screenName ?? key,
            avatarUrl: entry.avatarUrl,
            kolUserId: entry.userId,
        });
    }

    if (entries.length === 0) return;

    if (targetCatId === null) {
        const kolNames = Array.from(
            new Set(
                entries.map((item) => snapshots.get(item.key)?.kolName ?? item.screenName ?? item.key),
            ),
        );
        await removeKolsFromCategoryFromBG(kolNames);

        const idsToClear = Array.from(new Set(
            entries.map(e => e.userId).filter((x): x is string => !!x)
        ));
        for (const uid of idsToClear) {
            await browser.runtime.sendMessage({
                action: MsgType.TweetRemoveByKolID,
                data: {userId: uid},
            });
        }

    } else {
        await assignKolsToCategoryFromBG(uniqueKeys, targetCatId, snapshots);
    }

    const followingIds = Array.from(
        new Set(
            entries
                .filter((item) => item.sources.includes("following") && item.userId)
                .map((item) => item.userId!),
        ),
    );

    if (followingIds.length > 0) {
        await browser.runtime.sendMessage({
            action: MsgType.FollowingAssignCategory,
            data: {
                userIds: followingIds,
                categoryId: targetCatId,
            },
        });
    }
}

async function removeUnfollowedFromView(userIds: string[]) {
    if (!userIds || userIds.length === 0) return;

    const keysToDelete: string[] = [];
    const localRemoveIds: string[] = [];

    // 第一轮：区分要删除的用户与保留用户
    for (const [key, user] of unifiedByKey.entries()) {
        if (!user || !user.userId) continue;

        if (userIds.includes(user.userId)) {
            const isUnassigned = user.categoryId == null;

            if (isUnassigned) {
                // ✅ Unassigned：彻底删除
                keysToDelete.push(key);
                localRemoveIds.push(user.userId);
            } else {
                // ✅ 已分类：保留，但去掉 following 来源
                user.sources = user.sources.filter((s) => s !== "following");
            }
        }
    }

    // 第二轮：删除所有未分类的（彻底从 UI 移除）
    for (const key of keysToDelete) {
        const user = unifiedByKey.get(key);
        if (!user) continue;

        unifiedByKey.delete(key);
        unifiedKols = unifiedKols.filter((u) => u.userId !== user.userId);

        if (unifiedView?.uncategorized) {
            unifiedView.uncategorized = unifiedView.uncategorized.filter(
                (u) => u.userId !== user.userId,
            );
        }

        // 分类数据不动
    }

    // ✅ 同步后台删除（防止刷新恢复）
    if (localRemoveIds.length > 0) {
        try {
            await browser.runtime.sendMessage({
                action: MsgType.FollowingRemoveLocal,
                data: {userIds: localRemoveIds},
            });
        } catch (err) {
            console.warn("------>>> removeUnfollowedFromView: failed to remove locally", err);
        }
    }

    // 刷新前端展示
    renderAll();
}
