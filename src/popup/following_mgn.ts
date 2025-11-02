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
const toolbar = document.getElementById("toolbar") as HTMLDivElement;
const selectionCounter = document.getElementById("selection-counter") as HTMLSpanElement;
const categoryTemplate = document.getElementById("category-item-template") as HTMLTemplateElement;
const userTemplate = document.getElementById("user-card-template") as HTMLTemplateElement;
const addCategoryBtn = document.getElementById("add-category-btn") as HTMLButtonElement;

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
    addCategoryBtn.addEventListener("click", handleAddCategory);
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

    const renameBtn = li.querySelector(".rename-btn") as HTMLButtonElement;
    renameBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (!category) return;
        handleRenameCategory(category).then();
    });

    const deleteBtn = li.querySelector(".delete-btn") as HTMLButtonElement;
    deleteBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (!category) return;
        handleDeleteCategory(category).then();
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

            card.addEventListener("click", (ev) => {
                if (ev.target instanceof HTMLInputElement) return;
                checkbox.checked = !checkbox.checked;
                toggleUserSelection(user.key, checkbox.checked);
            });

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
    assignBtn.disabled = count === 0;
    clearSelectionBtn.disabled = count === 0;
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
            alert(rsp?.data ?? "Failed to sync followings.");
            return;
        }
        const count = rsp?.data?.count ?? 0;
        syncStatus.textContent = `Synced ${count} followings.`;
        selectedKeys.clear();
        await refreshData();
    } catch (error) {
        const err = error as Error;
        alert(err.message);
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

async function handleAssignCategory() {
    const keys = Array.from(selectedKeys);
    if (keys.length === 0) return;
    const value = assignSelect.value;
    if (value === "") return;
    const categoryId = value === UNCATEGORIZED_FILTER ? null : Number(value);
    if (categoryId !== null && Number.isNaN(categoryId)) {
        alert("Please select a valid category.");
        return;
    }
    try {
        await bulkAssignCategory(keys, categoryId);
        selectedKeys.clear();
        assignSelect.value = "";
        await refreshData();
    } catch (error) {
        const err = error as Error;
        alert(err.message);
    }
}

async function handleAddCategory() {
    const name = prompt("New category name");
    if (!name) return;
    const trimmed = name.trim();
    if (!trimmed) {
        alert("Category name cannot be empty.");
        return;
    }
    const category = new Category(trimmed);
    delete category.id;
    try {
        const id = await databaseAddItem(__tableCategory, category);
        category.id = Number(id);
        categories.push(category);
        renderCategoryList();
        renderAssignSelect();
    } catch (error) {
        console.warn("------>>> add category failed", error);
        alert("Failed to create category.");
    }
}

async function handleRenameCategory(category: Category) {
    const name = prompt("Rename category", category.catName);
    if (!name) return;
    const trimmed = name.trim();
    if (!trimmed) {
        alert("Category name cannot be empty.");
        return;
    }
    category.catName = trimmed;
    try {
        await updateCategoryDetail(category);
        categories = categories.map((cat) => (cat.id === category.id ? category : cat));
        renderCategoryList();
        renderAssignSelect();
    } catch (error) {
        console.warn("------>>> rename category failed", error);
        alert("Failed to rename category.");
    }
}

async function handleDeleteCategory(category: Category) {
    const confirmed = confirm(`Delete category "${category.catName}"?`);
    if (!confirmed) return;
    try {
        await removeCategory(category.id!);
        if (selectedFilter === category.id) {
            selectedFilter = ALL_FILTER;
        }
        selectedKeys.clear();
        await refreshData();
    } catch (error) {
        console.warn("------>>> delete category failed", error);
        alert("Failed to delete category.");
    }
}

async function buildUnifiedKOLView(): Promise<UnifiedKOLView> {
    const [categoryList, followingsList, kolMap] = await Promise.all([
        queryCategoriesFromBG(),
        fetchFollowings(),
        queryAllKolCategoryMapFromBG(),
    ]);

    const unifiedMap = new Map<string, UnifiedKOL>();

    for (const user of followingsList) {
        const screenName = user.screenName;
        if (!screenName) {
            continue;
        }
        const key = screenName.toLowerCase();
        const kicEntry = kolMap.get(key);
        const unified: UnifiedKOL = {
            key,
            screenName,
            displayName: user.name ?? screenName,
            userId: user.id,
            avatarUrl: user.avatarUrl,
            categoryId: kicEntry?.catID ?? null,
            sources: kicEntry ? ["following", "kic"] : ["following"],
        };
        if (kicEntry) {
            unified.displayName = kicEntry.displayName ?? unified.displayName;
            unified.avatarUrl = kicEntry.avatarUrl ?? unified.avatarUrl;
            if (kicEntry.kolUserId && !unified.userId) {
                unified.userId = kicEntry.kolUserId;
            }
        }
        unifiedMap.set(key, unified);
    }

    for (const [key, kol] of kolMap.entries()) {
        const existing = unifiedMap.get(key);
        if (existing) {
            existing.categoryId = kol.catID ?? null;
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
        unifiedMap.set(key, {
            key,
            screenName,
            displayName: kol.displayName ?? screenName,
            userId: kol.kolUserId,
            avatarUrl: kol.avatarUrl,
            categoryId: kol.catID ?? null,
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
