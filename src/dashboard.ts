import browser, {Runtime} from "webextension-polyfill";
import {Category, defaultUserName, MsgType} from "./consts";
import {__tableCategory, checkAndInitDatabase, databaseAddItem} from "./database";
import {showView} from "./utils";
import {loadCategories} from "./category";

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

    await setupMainHomeElm();
}

function dashRouter(path: string): void {
    // console.log("------>>> show view for path:", path);
    if (path === '#onboarding/main-home') {
    } else if (path === '#onboarding/category-manager') {
    }
}

browser.runtime.onMessage.addListener((request: any, _sender: Runtime.MessageSender, sendResponse: (response?: any) => void): true => {
    return dashboardMsgDispatch(request, _sender, sendResponse)
});

export function dashboardMsgDispatch(request: any, _sender: Runtime.MessageSender, sendResponse: (response?: any) => void): true {
    switch (request.action) {

        case MsgType.InitPopup:
            console.log("------>>> init pop up for path:", request.data);
            routeTarget = request.data;
            sendResponse({success: true});
            break;

        default:
            sendResponse({success: true});
            break;
    }
    return true;
}

async function setupMainHomeElm() {
    initNewCatBtn();
    initNewCatModalDialog();
    await setupCurCategoryList();
}

function initNewCatBtn() {
    const newCategoryBtn = document.getElementById("btn-add-category") as HTMLElement;
    newCategoryBtn.addEventListener('click', () => {
        const modalDialog = document.getElementById("modal-add-category") as HTMLElement
        modalDialog.style.display = 'block';
    })
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
        return;
    }

    //TODO::Show loading......
    const item = new Category(newCatStr, defaultUserName);
    delete item.id;
    const newID = await databaseAddItem(__tableCategory, item);
    if (!newID) {
        //TODO::show alert
        return;
    }
    await browser.runtime.sendMessage({action: MsgType.NewCategoryAdd, data: item.forUser});
    item.id = newID as number;
    await setupCurCategoryList();
    modalDialog.style.display = 'none'
    //hide loading
}

async function setupCurCategoryList() {
    const listDiv = document.getElementById("categories-list") as HTMLElement;
    const catItem = document.getElementById("category-item-template") as HTMLElement;
    const categories = await loadCategories(defaultUserName);

    listDiv.innerHTML = '';

    categories.forEach((category) => {
        const clone = catItem.cloneNode(true) as HTMLElement;
        _cloneCatItem(clone, category);
        listDiv.append(clone);
    });
}

function _cloneCatItem(clone: HTMLElement, category: Category) {
    clone.setAttribute('id', "category-item-" + category.id);
    clone.style.display = 'block';
    clone.dataset.categoryID = "" + category.id;
    clone.querySelector(".category-name")!.textContent = category.catName;

    const editBtn = clone.querySelector(".category-edit-btn") as HTMLElement;
    editBtn.addEventListener('click', () => {
        editCategory(category);
    });
}

function editCategory(cat: Category) {

}