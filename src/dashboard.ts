import browser from "webextension-polyfill";
import {__DBK_AD_Block_Key, choseColorByID, defaultUserName, MaxCategorySize, MsgType} from "./consts";
import {__tableCategory, checkAndInitDatabase, databaseAddItem} from "./database";
import {showView} from "./utils";
import {kolsForCategory, loadCategories, removeCategory, updateCategoryDetail} from "./category";
import {hideLoading, showAlert, showConfirmPopup, showLoading} from "./dash_common";
import {broadcastToContent} from "./bg_msg";
import {localGet, localSet} from "./local_storage";
import {Category} from "./object_Category";

console.log('------>>>Happy developing ✨')
document.addEventListener("DOMContentLoaded", initDashBoard as EventListener);

let routeTarget = "";

async function initDashBoard(): Promise<void> {
    await checkAndInitDatabase();
    if (routeTarget) {
        showView(routeTarget, dashRouter);
    } else {
        showView('#onboarding/main-home', dashRouter);
    }

    initNewCatBtn();
    initNewCatModalDialog();
    initSettings();
}

function dashRouter(path: string): void {
    // console.log("------>>> show view for path:", path);
    if (path === '#onboarding/main-home') {
        setHomeStatus().then();

    } else if (path === '#onboarding/category-manager') {
    }
}

function initNewCatBtn() {
    const newCategoryBtn = document.getElementById("btn-add-category") as HTMLElement;
    newCategoryBtn.onclick = async () => {
        const categories = await loadCategories(defaultUserName);
        if (categories.length >= MaxCategorySize) {
            showAlert("Tips", "You can create up to 4 categories for now. We'll support more soon!");
            return;
        }
        const modalDialog = document.getElementById("modal-add-category") as HTMLElement
        modalDialog.style.display = 'block';
    }
}

function initNewCatModalDialog() {
    const cancelBtn = document.getElementById("btn-cancel-new-category") as HTMLElement;
    const confirmBtn = document.getElementById("btn-confirm-new-category") as HTMLElement;
    const modalDialog = document.getElementById("modal-add-category") as HTMLElement

    cancelBtn.addEventListener('click', () => modalDialog.style.display = 'none');
    confirmBtn.addEventListener('click', addNewCategory);
}

async function addNewCategory() {

    const modalDialog = document.getElementById("modal-add-category") as HTMLElement
    const newCatInput = modalDialog.querySelector(".new-category-name") as HTMLInputElement;
    const newCatStr = newCatInput.value;
    if (!newCatStr) {
        showAlert("Tips", "Invalid category name");
        return;
    }

    showLoading()
    const item = new Category(newCatStr, defaultUserName);
    delete item.id;
    const newID = await databaseAddItem(__tableCategory, item);
    if (!newID) {
        showAlert("Tips", "Failed to add new category:" + newCatStr);
        hideLoading();
        return;
    }

    item.id = newID as number;
    await setHomeStatus();
    modalDialog.style.display = 'none'
    newCatInput.value = '';

    const changedCat = await loadCategories(item.forUser);
    broadcastToContent(MsgType.CategoryChanged, changedCat);
    hideLoading();
    showAlert("Tips", "Save Success");
}

async function setHomeStatus() {
    const listDiv = document.getElementById("categories-list") as HTMLElement;
    const catItem = document.getElementById("category-item-template") as HTMLElement;
    const categories = await loadCategories(defaultUserName);

    listDiv.innerHTML = '';

    categories.forEach((category) => {
        const clone = catItem.cloneNode(true) as HTMLElement;
        _cloneCatItem(clone, category);
        listDiv.append(clone);
    });

    const isEnabled: boolean = await localGet(__DBK_AD_Block_Key) as boolean ?? false
    const blockAdsToggle = document.getElementById('ad-block-toggle') as HTMLInputElement;
    blockAdsToggle.checked = isEnabled;
}

function _cloneCatItem(clone: HTMLElement, category: Category) {
    clone.setAttribute('id', "category-item-" + category.id);
    clone.style.display = 'flex';
    clone.dataset.categoryID = "" + category.id;
    clone.querySelector(".category-name")!.textContent = category.catName;

    const editBtn = clone.querySelector(".category-edit-btn") as HTMLElement;
    editBtn.onclick = () => {
        editCategory(category);
    }

    kolsForCategory(category.id!).then((result => {
        const kolSize = clone.querySelector(".kol-size-val") as HTMLElement;
        kolSize.textContent = "" + result.size;
        kolSize.onclick = () => {
            browser.tabs.create({
                url: browser.runtime.getURL("html/kolManage.html?catID=" + category.id + "&&catName=" + category.catName),
            }).then();
        }
        kolSize.style.color = choseColorByID(category.id!)
    }));
}

function editCategory(cat: Category) {
    const mgmDvi = document.getElementById("view-category-manager") as HTMLDivElement;

    const catIdDiv = mgmDvi.querySelector(".category-id") as HTMLDivElement
    catIdDiv.innerText = "" + cat.id;

    const catNameDiv = mgmDvi.querySelector(".category-name-val") as HTMLInputElement
    catNameDiv.value = cat.catName;

    const nameEditBtn = mgmDvi.querySelector(".name-edit") as HTMLElement;
    nameEditBtn.onclick = async () => {
        await editCateName(cat, mgmDvi)
    }

    const rmBtn = mgmDvi.querySelector(".category-remove-btn") as HTMLElement;
    rmBtn.onclick = () => {
        removeCatById(cat.id!);
    }

    const backBtn = mgmDvi.querySelector(".button-back") as HTMLElement;
    backBtn.onclick = () => {
        showView('#onboarding/main-home', dashRouter);
    }

    showView('#onboarding/category-manager', dashRouter);
}

async function editCateName(cat: Category, parent: HTMLElement) {
    const inputArea = parent.querySelector(".category-name-val") as HTMLInputElement;
    const newCatName = inputArea.value;
    if (!newCatName) {
        showAlert("Tips", "invalid category name");
        return;
    }
    cat.catName = inputArea.value;
    showLoading();
    await updateCategoryDetail(cat);
    broadcastToContent(MsgType.CategoryChanged, await loadCategories(defaultUserName));
    hideLoading();
    showAlert("Tips", "Update Success");
}

function removeCatById(catId: number) {
    showConfirmPopup("Delete this Category?", async () => {
        showLoading();
        await removeCategory(catId);
        broadcastToContent(MsgType.CategoryChanged, await loadCategories(defaultUserName));
        hideLoading();
        showView('#onboarding/main-home', dashRouter);
    });
}

function initSettings() {
    const blockAdsToggle = document.getElementById('ad-block-toggle') as HTMLInputElement;

    blockAdsToggle.onchange = async () => {
        const isEnabled = blockAdsToggle.checked;
        await localSet(__DBK_AD_Block_Key, isEnabled);
        console.log("------>>>Ad blocking is now", isEnabled ? "enabled" : "disabled");
        broadcastToContent(MsgType.AdsBlockChanged, isEnabled);
    };
}