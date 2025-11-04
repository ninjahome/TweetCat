import browser from "webextension-polyfill";
import {__DBK_AD_Block_Key, choseColorByID, MsgType} from "../common/consts";
import {__tableCategory, checkAndInitDatabase, databaseAddItem} from "../common/database";
import {showView} from "../common/utils";
import {loadCategories, removeCategory, updateCategoryDetail} from "../object/category";
import {hideLoading, showAlert, showConfirmPopup, showLoading} from "./dash_common";
import {sendMessageToX} from "../service_work/bg_msg";
import {localGet, localSet} from "../common/local_storage";
import {Category} from "../object/category";
import {kolsForCategory} from "../object/tweet_kol";
import {getSystemSetting, switchAdOn} from "../object/system_setting";
import {t} from "../common/i18n";

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

    initCatMgmBtn();
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

function initCatMgmBtn() {
    const mgnCategoryBtn = document.getElementById("btn-mgn-category") as HTMLElement;
    mgnCategoryBtn.innerText = t('manage_category');
    mgnCategoryBtn.onclick = async () => {
        browser.tabs.create({
            url: browser.runtime.getURL("html/following_mgm.html"),
        }).then();
    }
}

function initNewCatModalDialog() {
    const cancelBtn = document.getElementById("btn-cancel-new-category") as HTMLElement;
    const confirmBtn = document.getElementById("btn-confirm-new-category") as HTMLElement;
    const modalDialog = document.getElementById("modal-add-category") as HTMLElement
    (modalDialog.querySelector("h3") as HTMLElement).innerText = t('add_new_category');
    cancelBtn.innerText = t('cancel');
    confirmBtn.innerText = t('confirm');
    (modalDialog.querySelector(".new-category-name") as HTMLInputElement).placeholder = t('enter_category_name');

    cancelBtn.addEventListener('click', () => modalDialog.style.display = 'none');
    confirmBtn.addEventListener('click', addNewCategory);
}

async function addNewCategory() {

    const modalDialog = document.getElementById("modal-add-category") as HTMLElement;
    const newCatInput = modalDialog.querySelector(".new-category-name") as HTMLInputElement;

    const newCatStr = newCatInput.value;
    if (!newCatStr) {
        showAlert(t('tips_title'), t('invalid_category_name'));
        return;
    }

    showLoading()
    const item = new Category(newCatStr);
    delete item.id;
    const newID = await databaseAddItem(__tableCategory, item);
    if (!newID) {
        showAlert(t('tips_title'), t('add_category_failed', newCatStr));
        hideLoading();
        return;
    }

    item.id = newID as number;
    await setHomeStatus();
    modalDialog.style.display = 'none'
    newCatInput.value = '';

    const changedCat = await loadCategories();
    await sendMessageToX(MsgType.CategoryChanged, changedCat, false);
    hideLoading();
    showAlert(t('tips_title'), t('save_success'));
}

async function setHomeStatus() {
    const isEnabled: boolean = await localGet(__DBK_AD_Block_Key) as boolean ?? false//TODO:: refactor __DBK_AD_Block_Key logic
    const blockAdsToggle = document.getElementById('ad-block-toggle') as HTMLInputElement;
    blockAdsToggle.checked = isEnabled;

    const adNumber = document.querySelector(".number-blocked-txt") as HTMLSpanElement;
    (document.querySelector(".ads-blocked-tips") as HTMLSpanElement).innerText = t('block_ads');
    const setting = await getSystemSetting();
    adNumber.innerText = "" + setting.adsBlocked
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
    (mgmDvi.querySelector(".msg-category-label") as HTMLElement).innerText = t('category_label');

    const catIdDiv = mgmDvi.querySelector(".category-id") as HTMLDivElement
    catIdDiv.innerText = "" + cat.id;

    const catNameDiv = mgmDvi.querySelector(".category-name-val") as HTMLInputElement
    catNameDiv.value = cat.catName;

    const nameEditBtn = mgmDvi.querySelector(".name-edit") as HTMLElement;
    nameEditBtn.innerText = t('save');
    nameEditBtn.onclick = async () => {
        await editCateName(cat, mgmDvi)
    }

    const rmBtn = mgmDvi.querySelector(".category-remove-btn") as HTMLElement;
    rmBtn.innerText = t('remove');
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
        showAlert(t('tips_title'), t('invalid_category_name'));
        return;
    }
    cat.catName = inputArea.value;
    showLoading();
    await updateCategoryDetail(cat);
    await sendMessageToX(MsgType.CategoryChanged, await loadCategories());
    hideLoading();
    showAlert(t('tips_title'), t('update_success'));
}

function removeCatById(catId: number) {
    showConfirmPopup(t('category_delete_confirm'), async () => {
        showLoading();
        await removeCategory(catId);
        await sendMessageToX(MsgType.CategoryChanged, await loadCategories());
        hideLoading();
        showView('#onboarding/main-home', dashRouter);
    });
}

function initSettings() {
    const blockAdsToggle = document.getElementById('ad-block-toggle') as HTMLInputElement;

    blockAdsToggle.onchange = async () => {
        const isEnabled = blockAdsToggle.checked;
        await localSet(__DBK_AD_Block_Key, isEnabled);
        await switchAdOn(isEnabled);
        console.log("------>>>Ad blocking is now", isEnabled ? "enabled" : "disabled");
        await sendMessageToX(MsgType.AdsBlockChanged, isEnabled);
    };
}