import browser from "webextension-polyfill";
import {MsgType} from "../common/consts";
import {__tableCategory, checkAndInitDatabase, databaseAddItem} from "../common/database";
import {Category, queryCategoriesFromBG, removeCategory, updateCategoryDetail} from "../object/category";
import {FollowingUser} from "../object/following";

const ALL_FILTER = "all" as const;
const UNCATEGORIZED_FILTER = "uncategorized" as const;
type CategoryFilter = typeof ALL_FILTER | typeof UNCATEGORIZED_FILTER | number;

let categories: Category[] = [];
let followings: FollowingUser[] = [];
let selectedFilter: CategoryFilter = ALL_FILTER;
const selectedUserIds = new Set<string>();

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
        selectedUserIds.clear();
        renderUserList();
    });
    addCategoryBtn.addEventListener("click", handleAddCategory);
}

async function refreshData() {
    categories = await queryCategoriesFromBG();
    followings = await fetchFollowings();
    renderAll();
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
    let uncategorized = 0;
    for (const user of followings) {
        if (user.categoryId === null || user.categoryId === undefined) {
            uncategorized += 1;
        } else {
            counts.set(user.categoryId, (counts.get(user.categoryId) ?? 0) + 1);
        }
    }
    return {
        total: followings.length,
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
        noUsersMessage.style.display = followings.length === 0 ? "none" : "block";
    } else {
        noUsersMessage.style.display = "none";
    }

    filtered
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .forEach((user) => {
            const card = userTemplate.content.firstElementChild!.cloneNode(true) as HTMLElement;
            const checkbox = card.querySelector(".user-select") as HTMLInputElement;
            checkbox.dataset.id = user.id;
            checkbox.checked = selectedUserIds.has(user.id);
            checkbox.addEventListener("change", () => toggleUserSelection(user.id, checkbox.checked));

            const avatar = card.querySelector(".user-avatar") as HTMLImageElement;
            avatar.src = user.avatarUrl || "../images/logo_48.png";
            avatar.alt = `${user.name}'s avatar`;

            const nameElm = card.querySelector(".name") as HTMLElement;
            nameElm.textContent = user.name || user.screenName;

            const handleElm = card.querySelector(".handle") as HTMLElement;
            handleElm.textContent = `@${user.screenName}`;

            card.addEventListener("click", (ev) => {
                if (ev.target instanceof HTMLInputElement) return;
                checkbox.checked = !checkbox.checked;
                toggleUserSelection(user.id, checkbox.checked);
            });

            userList.appendChild(card);
        });

    updateSelectionSummary();
}

function getFilteredUsers(): FollowingUser[] {
    if (selectedFilter === ALL_FILTER) {
        return followings;
    }
    if (selectedFilter === UNCATEGORIZED_FILTER) {
        return followings.filter((user) => user.categoryId === null || user.categoryId === undefined);
    }
    return followings.filter((user) => user.categoryId === selectedFilter);
}

function toggleUserSelection(userId: string, selected: boolean) {
    if (selected) {
        selectedUserIds.add(userId);
    } else {
        selectedUserIds.delete(userId);
    }
    updateSelectionSummary();
}

function updateSelectionSummary() {
    const count = selectedUserIds.size;
    selectionCounter.textContent = `${count} selected`;
    assignBtn.disabled = count === 0;
    clearSelectionBtn.disabled = count === 0;
}

function updateEmptyState() {
    const hasData = followings.length > 0;
    emptyState.style.display = hasData ? "none" : "flex";
    toolbar.style.display = hasData ? "flex" : "none";
    userList.style.display = hasData ? "grid" : "none";
    if (!hasData) {
        selectedUserIds.clear();
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
        selectedUserIds.clear();
        followings = await fetchFollowings();
        renderAll();
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
    } else if (followings.length === 0) {
        syncStatus.textContent = "";
    }
}

async function handleAssignCategory() {
    const ids = Array.from(selectedUserIds);
    if (ids.length === 0) return;
    const value = assignSelect.value;
    const categoryId = value === UNCATEGORIZED_FILTER || value === "" ? null : Number(value);
    try {
        await browser.runtime.sendMessage({
            action: MsgType.FollowingAssignCategory,
            data: {userIds: ids, categoryId},
        });
        followings = followings.map((user) =>
            ids.includes(user.id)
                ? {...user, categoryId: categoryId === null ? null : categoryId}
                : user,
        );
        selectedUserIds.clear();
        renderAll();
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
        categories = categories.filter((cat) => cat.id !== category.id);
        followings = followings.map((user) =>
            user.categoryId === category.id ? {...user, categoryId: null} : user,
        );
        if (selectedFilter === category.id) {
            selectedFilter = ALL_FILTER;
        }
        renderAll();
    } catch (error) {
        console.warn("------>>> delete category failed", error);
        alert("Failed to delete category.");
    }
}
