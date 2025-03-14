import browser from "webextension-polyfill";
import {getCategoryKeys, setCurrentCategory} from "./content_category";
import {sendMsgToService} from "./utils";
import {MsgType} from "./consts";

export async function prepareFilterHtmlElm() {
    addCustomStyles('css/content.css');
    await appendFilterBtnToHomePage();
    translateInjectedElm();
}

async function appendFilterBtnToHomePage() {
    const navElement = document.querySelector('div[aria-label="Home timeline"] nav[role="navigation"]') as HTMLElement;
    if (!navElement) {
        console.log("------>>> home navigation div not found");
        setTimeout(() => {
            appendFilterBtnToHomePage();
        }, 3000);
        return;
    }

    const template = await parseContentHtml('html/content.html');
    const filterContainerDiv = template.content.getElementById("category-filter-container");
    const filterBtn = template.content.getElementById("category-filter-item");
    const moreBtn = template.content.getElementById("category-filter-more")
    if (!filterContainerDiv || !filterBtn || !moreBtn) {
        console.error("------>>> failed to load filter container for buttons", filterContainerDiv, filterBtn);
        return;
    }

    navElement.parentElement!.appendChild(filterContainerDiv);

    const categories = getCategoryKeys();

    categories.forEach((category) => {
        const cloneItem = filterBtn.cloneNode(true) as HTMLElement;
        cloneItem.id = "category-filter-item-" + category;
        const btn = cloneItem.querySelector(".category-filter-btn") as HTMLElement
        btn.innerText = category;
        btn.addEventListener('click', () => {
            changeFilterType(category, cloneItem);
        });
        filterContainerDiv.appendChild(cloneItem);
    });

    moreBtn.querySelector(".category-filter-more-btn")!.addEventListener('click', addMoreCategory);
    filterContainerDiv.appendChild(moreBtn);
}

function addCustomStyles(cssFilePath: string): void {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.type = 'text/css';
    link.href = browser.runtime.getURL(cssFilePath);
    document.head.appendChild(link);
}

async function parseContentHtml(htmlFilePath: string): Promise<HTMLTemplateElement> {
    const response = await fetch(browser.runtime.getURL(htmlFilePath));
    if (!response.ok) {
        throw new Error(`Failed to fetch ${htmlFilePath}: ${response.statusText}`);
    }
    const htmlContent = await response.text();
    const template = document.createElement('template');
    template.innerHTML = htmlContent;
    return template;
}

function translateInjectedElm() {
}

function changeFilterType(category: string, elmItem: HTMLElement) {
    setCurrentCategory(category);

    document.querySelectorAll(".category-filter-item").forEach((elm) => {
        elm.classList.remove("active");
    })
    elmItem.classList.add("active");
}

async function addMoreCategory() {
    await sendMsgToService("#onboarding/category-manager", MsgType.OpenPlugin);
}

export function checkFilterBtn() {
    const navElement = document.querySelector('div[aria-label="Home timeline"] nav[role="navigation"]') as HTMLElement;
    if (!navElement) {
        console.log("------>>> should have the navigation div")
        return;
    }

    const filterDiv = navElement.parentElement!.querySelector(".category-filter-container");
    if (filterDiv) {
        console.log("------>>> no need to append filter container again");
        return;
    }
    appendFilterBtnToHomePage().then();
}