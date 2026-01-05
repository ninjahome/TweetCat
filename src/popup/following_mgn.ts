import browser from "webextension-polyfill";
import {choseColorByID, MsgType, noXTabError, SNAPSHOT_TYPE} from "../common/consts";
import {
    __tableCategory,
    __tableFollowings,
    databaseAddItem,
    databaseUpdateOrAddItem
} from "../common/database";
import {
    Category,
    assignKolsToCategoryFromBG,
    queryAllKolCategoryMapFromBG,
    queryCategoriesFromBG,
    removeCategory,
    removeKolsFromCategoryFromBG,
    updateCategoryDetail,
} from "../object/category";
import {FollowingUser, removeLocalFollowings, replaceFollowingsPreservingCategories} from "../object/following";
import {logFM} from "../common/debug_flags";
import {sendMsgToService} from "../common/utils";
import {initI18n, t} from "../common/i18n";
import {$Id, hideLoading, showAlert, showLoading, showNotification} from "./common";
import {buildGatewayUrls, download, ensureSettings, unpinCid, uploadJson} from "../wallet/ipfs_api";
import {
    ERR_LOCAL_IPFS_HANDOFF,
    PROVIDER_TYPE_CUSTOM,
    PROVIDER_TYPE_LIGHTHOUSE,
    PROVIDER_TYPE_PINATA
} from "../wallet/ipfs_settings";
import {SnapshotV1} from "../common/msg_obj";
import {getManifest, updateFollowingSnapshot} from "../wallet/ipfs_manifest";
import {openPasswordModal} from "./password_modal";
import {getEOA} from "../wallet/cdp_wallet";

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


function formatStat(value: number | undefined, label: string): string | null {
    if (typeof value !== "number" || Number.isNaN(value)) {
        return null;
    }
    return `${numberFormatter.format(value)} ${label}`;
}

// ===== 安全声明区 =====
let categoryList: HTMLUListElement;
let userList: HTMLDivElement;
let emptyState: HTMLDivElement;
let noUsersMessage: HTMLDivElement;
let syncButtons: HTMLButtonElement[];
let syncStatus: HTMLSpanElement;
let assignSelect: HTMLSelectElement;
let assignBtn: HTMLButtonElement;
let clearSelectionBtn: HTMLButtonElement;
let unfollowSelectedBtn: HTMLButtonElement | null;
let toolbar: HTMLDivElement;
let selectionCounter: HTMLSpanElement;
let categoryTemplate: HTMLTemplateElement;
let userTemplate: HTMLTemplateElement;
let newCategoryBtn: HTMLButtonElement;
let commInputDialog: HTMLDivElement | null;
let dialogInput: HTMLInputElement | null;
let confirmNewCategoryBtn: HTMLButtonElement | null;
let cancelNewCategoryBtn: HTMLButtonElement | null;


let confirmModal: HTMLDivElement | null;
let confirmMessage: HTMLParagraphElement | null;
let cancelConfirmBtn: HTMLButtonElement | null;
let confirmConfirmBtn: HTMLButtonElement | null;
let processingOverlay: HTMLDivElement | null;
let exportIpfsBtn: HTMLButtonElement | null;
let ipfsLatestCidSpan: HTMLSpanElement | null;
let ipfsLatestOpenBtn: HTMLButtonElement | null;
let ipfsLatestCopyBtn: HTMLButtonElement | null;
let ipfsLatestSyncBtn: HTMLButtonElement | null = null;
let latestSnapshotCid: string | null = null;

// ===== DOM 初始化封装 =====
function initDomRefs(): void {
    initI18n();
    categoryList = $Id("category-list") as HTMLUListElement;
    userList = $Id("user-list") as HTMLDivElement;
    emptyState = $Id("empty-state") as HTMLDivElement;
    noUsersMessage = $Id("no-users-message") as HTMLDivElement;

    syncButtons = [
        $Id("sync-btn") as HTMLButtonElement,
        $Id("empty-sync-btn") as HTMLButtonElement,
    ];
    syncStatus = $Id("sync-status") as HTMLSpanElement;

    assignSelect = $Id("assign-category-select") as HTMLSelectElement;
    assignBtn = $Id("assign-category-btn") as HTMLButtonElement;
    clearSelectionBtn = $Id("clear-selection-btn") as HTMLButtonElement;
    unfollowSelectedBtn = $Id("unfollow-selected-btn") as HTMLButtonElement | null;

    toolbar = $Id("toolbar") as HTMLDivElement;
    selectionCounter = $Id("selection-counter") as HTMLSpanElement;

    categoryTemplate = $Id("category-item-template") as HTMLTemplateElement;
    userTemplate = $Id("user-card-template") as HTMLTemplateElement;

    newCategoryBtn = $Id("btn-new-category") as HTMLButtonElement;

    commInputDialog = $Id("modal-input-dialog") as HTMLDivElement | null;
    dialogInput = $Id("dialog-input") as HTMLInputElement | null;
    confirmNewCategoryBtn = $Id("btn-confirm-new-category") as HTMLButtonElement | null;
    cancelNewCategoryBtn = $Id("btn-cancel-new-category") as HTMLButtonElement | null;

    confirmModal = $Id("modal-confirm") as HTMLDivElement | null;
    confirmMessage = $Id("confirm-message") as HTMLParagraphElement | null;
    cancelConfirmBtn = $Id("btn-cancel-confirm") as HTMLButtonElement | null;
    confirmConfirmBtn = $Id("btn-confirm-confirm") as HTMLButtonElement | null;

    processingOverlay = $Id("unfollow-processing-overlay") as HTMLDivElement | null;

    // ===== 🌍 初始化翻译（整合 applyTranslations） =====
    document.querySelector(".sidebar-header h2")!.textContent = t("categories_title");
    newCategoryBtn.textContent = "＋ " + t("new_category");

    syncButtons[0].textContent = t("sync_followings");
    syncButtons[1].textContent = t("sync_followings");
    assignBtn.textContent = t("apply");
    clearSelectionBtn.textContent = t("clear");
    unfollowSelectedBtn!.textContent = t("unfollow_selected");

    emptyState.querySelector("p")!.textContent = t("empty_hint_no_sync");
    noUsersMessage.textContent = t("no_users_in_category");

    const input = dialogInput!;
    input.placeholder = t("enter_category_name");
    $Id("modal-add-category-title")!.textContent = t("create_new_category");
    cancelNewCategoryBtn!.textContent = t("cancel");
    confirmNewCategoryBtn!.textContent = t("confirm");

    $Id("modal-confirm-title")!.textContent = t("confirm_action");
    cancelConfirmBtn!.textContent = t("cancel");
    confirmConfirmBtn!.textContent = t("confirm");

    const pwdTitleEl = $Id("modal-password-title") as HTMLElement | null;
    if (pwdTitleEl) {
        pwdTitleEl.textContent = t("ipfs_password_title");
    }

    exportIpfsBtn = $Id("export-ipfs-btn") as HTMLButtonElement | null;
    if (exportIpfsBtn) {
        exportIpfsBtn.textContent = t("ipfs_snapshot_button");
        exportIpfsBtn.title = t("ipfs_snapshot_title");
    }

    const ipfsLatestLabel = $Id("ipfs-latest-label") as HTMLSpanElement | null;
    if (ipfsLatestLabel) {
        ipfsLatestLabel.textContent = t("ipfs_latest_label");
    }

    ipfsLatestCidSpan = $Id("ipfs-latest-cid") as HTMLSpanElement | null;
    if (ipfsLatestCidSpan) {
        ipfsLatestCidSpan.textContent = t("ipfs_latest_none");
    }

    ipfsLatestOpenBtn = $Id("ipfs-latest-open") as HTMLButtonElement | null;
    ipfsLatestCopyBtn = $Id("ipfs-latest-copy") as HTMLButtonElement | null;
    if (ipfsLatestCopyBtn) {
        ipfsLatestCopyBtn.textContent = t("ipfs_latest_copy_cid");
    }

    ipfsLatestSyncBtn = $Id("ipfs-latest-sync") as HTMLButtonElement | null;
    if (ipfsLatestSyncBtn) {
        ipfsLatestSyncBtn.textContent = t("ipfs_sync_data");
    }

    const processingText = $Id("processing-overlay-text") as HTMLSpanElement | null;
    if (processingText) {
        processingText.textContent = t("processing");
    }
}

type ConfirmCallback = () => void | Promise<void>;

let activeModal: HTMLElement | null = null;
let pendingConfirmHandler: ConfirmCallback | null = null;
let isProcessingUnfollow = false;

document.addEventListener("DOMContentLoaded", initFollowingManager as EventListener);

async function initFollowingManager() {
    initDomRefs();
    document.title = t("mgn_following");
    bindEvents();

    getEOA().then((acc) => {
        if (!acc) return;
        loadLatestSnapshotCid(acc.address).catch(e => {
            console.warn("[IPFS] skip loading latest snapshot cid:", e);
            updateIpfsLatestUI();
        });
    }).catch(err => {
        showNotification(err.message, "error")
    });

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
    dialogInput?.addEventListener("input", handleAddCategoryInputChange);
    dialogInput?.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            void handleAddCategoryConfirm();
        }
    });
    commInputDialog?.addEventListener("click", (event) => {
        if (event.target === commInputDialog) {
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

    exportIpfsBtn.onclick = async () => {
        await handleExportSnapshotToIpfs((cid) => {
            latestSnapshotCid = cid;
            updateIpfsLatestUI();
        });
    }

    ipfsLatestOpenBtn?.addEventListener("click", () => {
        if (!latestSnapshotCid) return;
        void openSnapshotInGateway(latestSnapshotCid);
    });

    ipfsLatestCopyBtn?.addEventListener("click", () => {
        if (!latestSnapshotCid) return;
        navigator.clipboard?.writeText(latestSnapshotCid)
            .then(() => showNotification("CID 已复制到剪贴板", "info"))
            .catch(() => showNotification("复制失败，请手动复制", "error"));
    });

    ipfsLatestSyncBtn?.addEventListener("click", handleSyncFromIpfsClick);
}

async function handleSyncFromIpfsClick() {
    if (!latestSnapshotCid) return;

    // 第0步：检查本地是否有 followings 数据
    const localFollowings = await fetchFollowings();
    if (!localFollowings || localFollowings.length === 0) {
        showConfirmModal(t("ipfs_sync_no_local_followings"), () => {
            if (syncButtons && syncButtons[0]) {
                console.log("------>>> Auto-triggering sync followings");
                syncButtons[0].click();
            }
        })
        return;
    }

    showConfirmModal(t("ipfs_confirm_sync_from_ipfs_overwrite"), async () => {
        try {
            // 第1步：下载快照数据
            showLoading(t("ipfs_sync_step_downloading"));
            const jsonObj = await download(latestSnapshotCid);
            console.log("------>>> Downloaded snapshot:", jsonObj);

            if (!jsonObj || typeof jsonObj !== 'object') {
                showNotification(t("ipfs_invalid_snapshot_data") || 'Invalid snapshot data', "error");
                return;
            }

            const {version, categories: importedCategories, assignments: importedAssignments} = jsonObj as any;
            console.log("------>>>current snapshot version:", version)
            if (!Array.isArray(importedCategories) || !Array.isArray(importedAssignments)) {
                showNotification(t("ipfs_invalid_snapshot_format") || 'Invalid snapshot format', "error");
                return;
            }

            // 第2步：清除旧分类
            showLoading(t("ipfs_sync_step_clearing_categories"));
            for (const cat of categories) {
                if (cat.id) {
                    await removeCategory(cat.id);
                }
            }

            // 第3步：导入新分类，并建立 ID 映射
            showLoading(t("ipfs_sync_step_importing_categories"));
            const newCatMap = new Map<number, number>();
            for (const importedCat of importedCategories) {
                const catName = importedCat.name || importedCat.catName;
                if (!catName) continue;

                const newCat = new Category(catName);
                // 不设置 id，让数据库自动生成
                delete (newCat as any).id;
                const newId = await databaseAddItem(__tableCategory, newCat);
                newCatMap.set(importedCat.id, Number(newId));
                console.log(`------>>> Category mapped: ${importedCat.id} -> ${newId}`);
            }

            // 第4步：更新 followings 的分类关联
            showLoading(t("ipfs_sync_step_updating_assignments"));

            // 建立 userId -> 新分类 ID 的映射
            const assignmentMap = new Map<string, number | null>();
            for (const assign of importedAssignments) {
                if (assign.userId) {
                    const newCatId = assign.categoryId ? newCatMap.get(assign.categoryId) || null : null;
                    assignmentMap.set(assign.userId, newCatId);
                }
            }

            // 从后台脚本获取所有 followings
            const allFollowings = await fetchFollowings();
            let updatedCount = 0;

            // 遍历所有 followings，更新分类
            for (const following of allFollowings) {
                if (!following.userId) continue;

                // 如果在导入的 assignments 中，使用新的分类ID
                // 如果不在，则设为 null（未分类）
                if (assignmentMap.has(following.userId)) {
                    following.categoryId = assignmentMap.get(following.userId) || null;
                } else {
                    following.categoryId = null;
                }

                // 保存到数据库
                await databaseUpdateOrAddItem(__tableFollowings, following);
                updatedCount++;
            }

            console.log(`------>>> Updated ${updatedCount} followings`);

            // 第5步：刷新界面
            showLoading(t("ipfs_sync_step_refreshing"));
            selectedKeys.clear();
            await refreshData();

            showNotification(
                t("ipfs_sync_success_with_count", updatedCount.toString()) ||
                `Data synchronized: ${updatedCount} followings updated`,
                "info"
            );

        } catch (e) {
            const err = e as Error;
            console.error("------>>> handleSyncFromIpfsClick error details:", e);
            showNotification(
                err.message || (t("ipfs_sync_failed") || "Failed to synchronize from IPFS"),
                "error"
            );
        } finally {
            hideLoading();
        }
    })

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
    if (activeModal === commInputDialog) {
        hideAddCategoryModal();
    } else if (activeModal === confirmModal) {
        hideConfirmModal();
    }
}

function handleAddCategoryInputChange() {
    if (!dialogInput || !confirmNewCategoryBtn) return;
    const hasValue = dialogInput.value.trim().length > 0;
    confirmNewCategoryBtn.disabled = !hasValue;
}

function resetAddCategoryModal() {
    if (!dialogInput || !confirmNewCategoryBtn) return;
    dialogInput.value = "";
    confirmNewCategoryBtn.disabled = true;
}

function showAddCategoryModal() {
    resetAddCategoryModal();
    openModal(commInputDialog);
    window.setTimeout(() => {
        dialogInput?.focus();
    }, 0);
}

function hideAddCategoryModal() {
    resetAddCategoryModal();
    closeModal(commInputDialog);
}

async function handleAddCategoryConfirm() {
    if (!dialogInput || !confirmNewCategoryBtn) return;
    const name = dialogInput.value.trim();
    if (!name) return;
    confirmNewCategoryBtn.disabled = true;
    try {
        await addNewCategory(name);
        hideAddCategoryModal();
    } catch (error) {
        console.warn("------>>> add category failed", error);
        confirmNewCategoryBtn.disabled = dialogInput.value.trim().length === 0;
        confirmNewCategoryBtn.focus();
    }
}

function hideConfirmModal() {
    pendingConfirmHandler = null;
    closeModal(confirmModal);
}

function showConfirmModal(message: string, onConfirm: ConfirmCallback) {
    if (!confirmModal || !confirmMessage || !confirmConfirmBtn) return;
    confirmMessage.textContent = message;
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
        showNotification(err?.message ?? t("operation_failed"), "error");
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

    const allLabel = `${t("category_all")}`;// (${counts.total})
    const allItem = createCategoryElement(ALL_FILTER, allLabel, true, counts);
    categoryList.appendChild(allItem);
    (document.getElementById("web2-following-no-val") as HTMLElement).innerText = "" + counts.total;

    const uncategorizedLabel = `${t("category_uncategorized")}`;// (${counts.uncategorized})
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
        const li = categoryTemplate.content.firstElementChild!.cloneNode(true) as HTMLElement;
        li.querySelector(".category-actions").remove()
        li.dataset.filter = String(filter);
        li.querySelector(".category-name")!.textContent = label;
        if (filter === ALL_FILTER) li.querySelector(".category-count")!.textContent = `${counts.total ?? 0}`;
        if (filter === UNCATEGORIZED_FILTER) li.querySelector(".category-count")!.textContent = `${counts.uncategorized ?? 0}`;
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
    if (renameBtn) {
        renameBtn.title = t("rename_category_prompt");
        renameBtn.addEventListener("click", (ev) => {
            ev.stopPropagation();
            if (!category) return;
            void handleRenameCategory(category);
        });
    }

    const deleteBtn = li.querySelector<HTMLButtonElement>(".delete-btn");
    if (deleteBtn) {
        deleteBtn.title = t("category_delete_tooltip");
        deleteBtn.addEventListener("click", (ev) => {
            ev.stopPropagation();
            if (!category) return;
            handleDeleteCategory(category);
        });
    }

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
    defaultOption.textContent = t("assign_to_category");
    assignSelect.appendChild(defaultOption);

    const removeOption = document.createElement("option");
    removeOption.value = UNCATEGORIZED_FILTER;
    removeOption.textContent = t("remove_from_category");
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
    // selectionCounter.textContent = `${count} selected`;
    selectionCounter.textContent = t("selected_count", selectedKeys.size.toString());
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
    showLoading(t("sync_followings"))
    setSyncLoading(true);
    try {
        const rsp = await sendMsgToService({}, MsgType.FollowingSync)// browser.runtime.sendMessage({action: MsgType.FollowingSync});
        if (!rsp?.success) {
            const message = typeof rsp?.data === "string" ? rsp.data : t("failed_to_sync_followings");
            if (typeof message === "string" && message.includes(noXTabError)) {
                showConfirmModal(
                    t("confirm_signin_x_first"),
                    () => {
                        window.open("https://x.com", "_blank");
                    }
                );
            } else {
                showNotification(message || t("failed_to_unfollow_selected"), "error");
            }
            return;
        }

        const users = rsp.data as FollowingUser[] ?? [];
        await replaceFollowingsPreservingCategories(users);
        syncStatus.textContent = t("synced_followings_count", users.length.toString());
        selectedKeys.clear();
        await refreshData();
    } catch (error) {
        const err = error as Error;
        showNotification(err.message ?? "Failed to sync followings.", "error");
    } finally {
        setSyncLoading(false);
        hideLoading()
    }
}

function setSyncLoading(loading: boolean) {
    syncButtons.forEach((btn) => {
        if (!btn) return;
        btn.disabled = loading;
        btn.textContent = loading ? t("syncing") : t("sync_followings");
    });
    if (loading) {
        syncStatus.textContent = t("syncing_followings");
    } else {
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
        showNotification(t("no_real_followings_to_unfollow"), "info");
        return;
    }
    const message =
        targets.length === 1
            ? t("confirm_unfollow_selected_one")
            : t("confirm_unfollow_selected", targets.length.toString());
    showConfirmModal(message, () => {
        performBatchUnfollow(targets).then();
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
            showNotification(t("no_valid_accounts_to_unfollow"), "error");
            return;
        }

        const response = await sendMsgToService({
            userIds,
            throttleMs: UNFOLLOW_REQUEST_DELAY_MS,
        }, MsgType.FollowingBulkUnfollow)

        if (!response) {
            showNotification(t("no_response_from_background"), "error");
            return;
        }

        if (response?.success === false) {
            const message = typeof response?.data === "string" ? response.data : response?.error;
            if (typeof message === "string" && message.includes("no_x_tab")) {
                showConfirmModal(
                    t('confirm_signin_x_first'),
                    () => {
                        window.open("https://x.com", "_blank");
                    }
                );
            } else {
                showNotification(message || t("failed_to_unfollow_selected"), "error");
            }
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
            showNotification(t("failed_to_unfollow_selected"), "error");
        } else {
            showNotification(
                `Unfollowed ${successCount} account${successCount === 1 ? "" : "s"}. ${failureCount} failed.`,
                "error",
            );
        }
    } catch (error) {
        const err = error as Error;
        showNotification(err?.message ?? t("failed_to_unfollow_selected"), "error");
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
        showNotification(t("please_select_valid_category"), "error");
        return;
    }

    const handler = async () => {
        await applyCategoryAssignment(keys, categoryId);
    };

    if (categoryId === null) {
        showConfirmModal(t("confirm_remove_from_category"), handler);
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
                ? t("removed_from_category_success")
                : t("assigned_to_category_success");
        showNotification(message, "info");
    } catch (error) {
        const err = error as Error;
        showNotification(err?.message ?? t("failed_to_update_category_assignment"), "error");
    }
}

async function addNewCategory(name: string) {
    const trimmed = name.trim();
    if (!trimmed) {
        showNotification(t("category_name_empty"), "error");
        throw new Error(t("category_name_empty"));
    }
    const category = new Category(trimmed);
    delete category.id;
    try {
        const id = await databaseAddItem(__tableCategory, category);
        category.id = Number(id);
        categories.push(category);
        renderCategoryList();
        renderAssignSelect();
        showNotification(t("created_category", category.catName), "info");
    } catch (error) {
        console.warn("------>>> add category failed", error);
        showNotification(t("failed_to_create_category"), "error");
        throw error;
    }
}

async function handleRenameCategory(category: Category) {

    const name = await showRenameCategoryDialog(
        category.catName,
        t("rename_category_prompt")
    );
    if (!name) return;

    const trimmed = name.trim();
    if (!trimmed) {
        showNotification(t("category_name_empty"), "error");
        return;
    }
    category.catName = trimmed;
    try {
        await updateCategoryDetail(category);
        categories = categories.map((cat) => (cat.id === category.id ? category : cat));
        renderCategoryList();
        renderAssignSelect();
        showNotification(t("renamed_category", category.catName), "info");
    } catch (error) {
        console.warn("------>>> rename category failed", error);
        showNotification(t("failed_to_rename_category"), "error");
    }
}

function handleDeleteCategory(category: Category) {
    showConfirmModal(t("confirm_delete_category", category.catName), async () => {
        try {
            await removeCategory(category.id!);
            if (selectedFilter === category.id) {
                selectedFilter = ALL_FILTER;
            }
            selectedKeys.clear();
            await refreshData();
            showNotification(t("category_deleted"), "info");
        } catch (error) {
            console.warn("------>>> delete category failed", error);
            showNotification(t("failed_to_delete_category"), "error");
        }
    });
}

async function buildUnifiedKOLView(): Promise<UnifiedKOLView> {
    const [categoryList, followingsList, kolMap] = await Promise.all([
        queryCategoriesFromBG(),
        fetchFollowings(),
        queryAllKolCategoryMapFromBG(),
    ]);
    const followingCnt = $Id("web2-following-no-title")
    followingCnt.textContent = "" + followingsList.length
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
            userId: user.userId,
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

    for (const [key, user] of unifiedByKey.entries()) {
        if (!user || !user.userId) continue;

        if (userIds.includes(user.userId)) {
            const isUnassigned = user.categoryId == null;

            if (isUnassigned) {
                keysToDelete.push(key);
            } else {
                user.sources = user.sources.filter((s) => s !== "following");
            }
        }
    }

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
    }

    await removeLocalFollowings(userIds);
    renderAll();
}


function renderUserList() {
    userList.innerHTML = "";

    const filtered = getFilteredUsers();
    updateNoUsersMessage(filtered);

    const sorted = sortUsers(filtered);

    for (const user of sorted) {
        const card = buildUserCard(user);
        userList.appendChild(card);
    }

    updateSelectionSummary();
}

function updateNoUsersMessage(filtered: UnifiedKOL[]) {
    if (filtered.length === 0) {
        noUsersMessage.style.display = unifiedKols.length === 0 ? "none" : "block";
    } else {
        noUsersMessage.style.display = "none";
    }
}

function sortUsers(users: UnifiedKOL[]): UnifiedKOL[] {
    return users.slice().sort((a, b) => {
        const nameA = (a.displayName ?? a.screenName ?? a.key).toLowerCase();
        const nameB = (b.displayName ?? b.screenName ?? b.key).toLowerCase();
        return nameA.localeCompare(nameB);
    });
}

function buildUserCard(user: UnifiedKOL): HTMLElement {
    const card = userTemplate.content.firstElementChild!.cloneNode(true) as HTMLElement;

    fillUserBaseInfo(card, user);
    fillUserCategoryBadge(card, user);
    fillUserBio(card, user);
    fillUserSyncButton(card, user);
    fillUserMeta(card, user);
    attachUserCardEvents(card, user);

    card.classList.add(user.sources.includes("following") ? "is-following" : "is-local-only");
    return card;
}

function fillUserBaseInfo(card: HTMLElement, user: UnifiedKOL) {
    const checkbox = card.querySelector(".user-select") as HTMLInputElement;
    checkbox.dataset.key = user.key;
    checkbox.checked = selectedKeys.has(user.key);
    checkbox.addEventListener("change", () => toggleUserSelection(user.key, checkbox.checked));

    const avatar = card.querySelector(".user-avatar") as HTMLImageElement;
    avatar.src = user.avatarUrl || "../images/logo_48.png";
    avatar.alt = `${user.displayName ?? user.screenName ?? user.key}'s avatar`;

    const nameElm = card.querySelector(".name") as HTMLElement;
    nameElm.textContent = user.displayName ?? user.screenName ?? user.key;
    if (user.screenName) {
        nameElm.style.cursor = "pointer";
        nameElm.title = `Open @${user.screenName} on X`;
        nameElm.addEventListener("click", (ev) => {
            ev.stopPropagation();
            window.open(`https://x.com/${user.screenName}`, "_blank");
        });
    }

    const handleElm = card.querySelector(".handle") as HTMLElement;
    handleElm.textContent = user.screenName ? `@${user.screenName}` : "";
}

function fillUserCategoryBadge(card: HTMLElement, user: UnifiedKOL) {
    const badge = card.querySelector(".category-badge") as HTMLElement | null;
    const dot = card.querySelector(".category-dot") as HTMLElement | null;
    const catName = card.querySelector(".category-name") as HTMLElement | null;

    if (badge && dot && catName) {
        if (selectedFilter === ALL_FILTER && user.categoryName && user.categoryId != null) {
            badge.classList.remove("hidden");
            catName.textContent = user.categoryName;
            dot.style.backgroundColor = choseColorByID(user.categoryId, 1);
        } else {
            badge.classList.add("hidden");
        }
    }
}

function fillUserBio(card: HTMLElement, user: UnifiedKOL) {
    const bioWrapper = card.querySelector(".bio-wrapper") as HTMLElement | null;
    const bioText = card.querySelector(".bio-text") as HTMLElement | null;
    const bioTooltip = card.querySelector(".bio-tooltip") as HTMLElement | null;

    if (!bioWrapper || !bioText || !bioTooltip) return;

    if (user.bio?.trim()) {
        const bio = user.bio.trim();
        bioText.textContent = bio;
        bioTooltip.textContent = bio;
        bioWrapper.classList.remove("hidden");
    } else {
        bioWrapper.classList.add("hidden");
    }
}

function fillUserSyncButton(card: HTMLElement, user: UnifiedKOL) {
    const syncBtn = card.querySelector(".sync-btn") as HTMLButtonElement | null;
    if (!syncBtn) return;

    const isLocalOnly = !user.sources.includes("following");

    if (!isLocalOnly) {
        syncBtn.classList.add("hidden");
        return;
    }

    const web2FollowingNoTitle = $Id("web2-following-no-title")
    web2FollowingNoTitle.textContent = t("web2_following_no_title");
    syncBtn.classList.remove("hidden");
    syncBtn.title = t("sync_user_now");
    syncBtn.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        await syncFollowingFromTwitterSrv(user);
    });
}

async function syncFollowingFromTwitterSrv(user: UnifiedKOL) {
    try {
        showNotification(t("syncing_user", user.displayName ?? user.screenName ?? user.key));
        const resp = await sendMsgToService(user.screenName ?? user.key, MsgType.FollowingFetchOne);

        if (resp?.success && resp.data) {
            const updated = {...user, ...resp.data, categoryId: user.categoryId ?? null, lastSyncedAt: Date.now()};
            await databaseUpdateOrAddItem(__tableFollowings, updated);
            showNotification(t("account_updated"), "info");
            await refreshData();
        } else {
            handleSyncError(resp);
        }
    } catch (err) {
        showNotification(t("sync_failed_with_error", (err as Error).message), "error");
    }
}

function handleSyncError(resp: any) {
    showNotification(t("sync_user_not_found"), "error");
    const message = typeof resp?.data === "string" ? resp.data : resp?.error;
    if (message?.includes(noXTabError)) {
        showConfirmModal(t("confirm_signin_x_first"), () => {
            window.open("https://x.com", "_blank")
        });
    } else {
        showNotification(message || t('failed_to_unfollow_selected'), "error");
    }
}

function fillUserMeta(card: HTMLElement, user: UnifiedKOL) {
    const statsElm = card.querySelector(".stats") as HTMLElement | null;
    if (statsElm) {
        const parts = [
            formatStat(user.followersCount, "Followers"),
            formatStat(user.friendsCount, "Following"),
            formatStat(user.statusesCount, "Tweets"),
        ].filter(Boolean);
        if (parts.length > 0) {
            statsElm.textContent = parts.join(" • ");
            statsElm.classList.remove("hidden");
        } else {
            statsElm.textContent = "";
            statsElm.classList.add("hidden");
        }
    }

    const metaElm = card.querySelector(".meta") as HTMLElement | null;
    if (metaElm) {
        // const hasLocation = locationElm && !locationElm.classList.contains("hidden");
        const hasStats = statsElm && !statsElm.classList.contains("hidden");
        metaElm.classList.toggle("hidden", !hasStats);
    }
}

function attachUserCardEvents(card: HTMLElement, user: UnifiedKOL) {
    const checkbox = card.querySelector(".user-select") as HTMLInputElement;
    card.addEventListener("click", (ev) => {
        if (ev.target instanceof HTMLInputElement) return;
        checkbox.checked = !checkbox.checked;
        toggleUserSelection(user.key, checkbox.checked);
    });
}

async function promptPasswordOnce(): Promise<string> {
    const pwd = await openPasswordModal(t("ipfs_password_title"));
    if (!pwd || !pwd.trim()) {
        throw new Error(t('password_tips_no_input'));
    }
    return pwd.trim();
}

// ★ 新增：根据设置判断是否需要口令
function ipfsNeedsPassword(settings: any): boolean {
    const provider = settings?.provider;
    if (provider === PROVIDER_TYPE_PINATA || provider === PROVIDER_TYPE_LIGHTHOUSE) return true;
    if (provider === PROVIDER_TYPE_CUSTOM) {
        const auth = settings?.custom?.authorization ?? settings?.custom?.auth ?? "";
        return typeof auth === "string" && auth.trim().length > 0;
    }
    return false;
}

/** 从 manifest 中加载最新快照 CID，写入 latestSnapshotCid 并刷新 UI */
async function loadLatestSnapshotCid(walletAddress: string): Promise<void> {
    try {
        const manifest = await getManifest(walletAddress);
        if (manifest && Array.isArray(manifest.items)) {
            const item = manifest.items.find(it => it.type === SNAPSHOT_TYPE);
            latestSnapshotCid = item ? item.cid : null;
        } else {
            latestSnapshotCid = null;
        }
    } catch (err) {
        console.warn("[IPFS] loadLatestSnapshotCid failed", err);
        latestSnapshotCid = null;
    }
    updateIpfsLatestUI();
}


async function handleExportSnapshotToIpfs(
    onSuccess?: (cid: string) => void
): Promise<void> {
    let settings: any;
    let password: string | undefined;

    try {
        settings = await ensureSettings();
        const needPassword = ipfsNeedsPassword(settings);
        if (needPassword) {
            password = await promptPasswordOnce();
        }

        showLoading("正在上传 IPFS 快照…");

        const cats = categories
            .filter(c => typeof c.id === "number")
            .map(c => ({id: c.id!, name: c.catName}));

        const assigns = unifiedKols
            .filter(u => typeof u.categoryId === "number")
            .map(u => ({
                screenName: u.screenName ?? u.key,
                userId: u.userId,
                categoryId: u.categoryId as number,
            }));

        const snapshot: SnapshotV1 = {
            version: 1,
            createdAt: new Date().toISOString(),
            categories: cats,
            assignments: assigns,
        };

        const {createdAt, ...snapshotCore} = snapshot;

        const w = await getEOA();
        if (!w) {
            showAlert(t('tips_title'), t('wallet_error_no_wallet'))
            return
        }
        const wallet = w.address.toLowerCase();
        const snapshotCid = await uploadJson(settings, snapshotCore, wallet, password);
        showNotification(t("ipfs_snapshot_uploaded_copied", snapshotCid), "info");
        onSuccess?.(snapshotCid);

        const {manifest, cid, oldSnapshotCids} = await updateFollowingSnapshot(wallet, snapshotCid);
        console.log("------>>> newest manifest:", manifest, cid, oldSnapshotCids);

        for (const oldCid of oldSnapshotCids) {
            await unpinCid(settings, oldCid, password);
        }
    } catch (err) {
        const e = err as Error;
        if (e.message === ERR_LOCAL_IPFS_HANDOFF) {
            return;
        }
        if (e.message === "已取消：未输入口令") {
            return;
        }

        showNotification(e.message ?? "上传失败", "error");
    } finally {
        hideLoading();
    }
}

/** 把 CID 截断成前后几位，方便展示 */
function shortenCid(cid: string, visible: number = 6): string {
    if (!cid) return "";
    if (cid.length <= visible * 2 + 3) return cid;
    return `${cid.slice(0, visible)}…${cid.slice(-visible)}`;
}

function updateIpfsLatestUI(): void {
    const cid = latestSnapshotCid;
    const hasCid = !!cid;

    if (ipfsLatestCidSpan) {
        ipfsLatestCidSpan.textContent = hasCid ? shortenCid(cid!) : t("ipfs_latest_none");
        ipfsLatestCidSpan.title = hasCid ? cid! : "";
    }
    if (ipfsLatestOpenBtn) {
        ipfsLatestOpenBtn.disabled = !hasCid;
    }
    if (ipfsLatestCopyBtn) {
        ipfsLatestCopyBtn.disabled = !hasCid;
    }

    if (ipfsLatestSyncBtn) {
        ipfsLatestSyncBtn.disabled = !hasCid;
        ipfsLatestSyncBtn.classList.toggle("hidden", !hasCid);
    }
}

async function canReachGateway(url: string, timeoutMs: number = 5000): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const resp = await fetch(url, {
            method: "HEAD",
            signal: controller.signal,
        });
        return resp.ok;
    } catch (_e) {
        return false;
    } finally {
        clearTimeout(timer);
    }
}

async function openSnapshotInGateway(cid: string): Promise<void> {
    try {
        showLoading(t("ipfs_looking_for_snapshot"));

        // 获取所有网关列表（已按优先级排序）
        const gatewayUrls = await buildGatewayUrls(cid);

        if (gatewayUrls.length === 0) {
            showNotification(t("ipfs_no_available_gateway") || "No available gateways", "error");
            return;
        }

        // 依次测试每个网关的可达性
        let reachableUrl: string | null = null;
        for (const url of gatewayUrls) {
            if (await canReachGateway(url, 5000)) {
                reachableUrl = url;
                break;
            }
        }

        // 打开第一个可达的网关，如果都不可达就打开第一个 URL（网络问题交给浏览器处理）
        const urlToOpen = reachableUrl || gatewayUrls[0];
        window.open(urlToOpen, "_blank");

    } catch (err) {
        console.error("[IPFS] openSnapshotInGateway failed", err);
        showNotification(t("ipfs_open_snapshot_failed") || "Failed to open snapshot", "error");
    } finally {
        hideLoading();
    }
}

export function showRenameCategoryDialog(
    initialName: string = "",
    title?: string
): Promise<string | null> {
    return new Promise((resolve) => {
        const dialog = document.getElementById("new-category-dialog") as HTMLDivElement | null;
        const input = dialog?.querySelector<HTMLInputElement>("#new-category-name-input");
        const btnConfirm = dialog?.querySelector<HTMLButtonElement>("#btn-confirm-rename");
        const btnCancel = dialog?.querySelector<HTMLButtonElement>("#btn-cancel-rename");
        const titleEl = dialog?.querySelector<HTMLElement>("#new-category-dialog-title");

        if (!dialog || !input || !btnConfirm || !btnCancel) {
            console.warn("[rename-dialog] DOM not found");
            resolve(null);
            return;
        }

        // 设置标题（如果有传）
        if (title && titleEl) {
            titleEl.textContent = title;
        }

        // 初始值
        input.value = initialName ?? "";

        const updateConfirmState = () => {
            const trimmed = input.value.trim();
            btnConfirm.disabled = trimmed.length === 0;
        };
        updateConfirmState();

        dialog.classList.remove("hidden");
        document.body.classList.add("modal-open");
        input.focus();
        input.select();

        const cleanup = (value: string | null) => {
            dialog.classList.add("hidden");
            document.body.classList.remove("modal-open");

            btnConfirm.removeEventListener("click", onConfirm);
            btnCancel.removeEventListener("click", onCancel);
            dialog.removeEventListener("click", onBackdropClick);
            input.removeEventListener("keydown", onKeydown);
            input.removeEventListener("input", onInput);

            resolve(value);
        };

        const onConfirm = () => {
            const value = input.value;
            cleanup(value);
        };

        const onCancel = () => {
            cleanup(null);
        };

        const onBackdropClick = (ev: MouseEvent) => {
            if (ev.target === dialog) {
                cleanup(null);
            }
        };

        const onKeydown = (ev: KeyboardEvent) => {
            if (ev.key === "Enter") {
                ev.preventDefault();
                if (!btnConfirm.disabled) {
                    onConfirm();
                }
            } else if (ev.key === "Escape") {
                ev.preventDefault();
                onCancel();
            }
        };

        const onInput = () => {
            updateConfirmState();
        };

        btnConfirm.addEventListener("click", onConfirm);
        btnCancel.addEventListener("click", onCancel);
        dialog.addEventListener("click", onBackdropClick);
        input.addEventListener("keydown", onKeydown);
        input.addEventListener("input", onInput);
    });
}
