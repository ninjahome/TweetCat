import browser from "webextension-polyfill";
import {getCategoryKeys, setCurrentCategory} from "./content_category";
import {sendMsgToService} from "./utils";
import {MsgType, TweetUser} from "./consts";

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

function filterTweetsByCategory(category: string) {
    const tweetsContainer = document.querySelector('div[aria-label="Timeline: Your Home Timeline"]') as HTMLElement;
    if (!tweetsContainer) {
        console.warn("------>>> failed to find tweet container when starting to filter")
        return;
    }

    tweetsContainer.querySelectorAll('div[data-testid="cellInnerDiv"]').forEach(node => {
        const tweetNode = node as HTMLElement;
        const userNameDiv = tweetNode.querySelector('div[data-testid="User-Name"]') as HTMLElement;

        if (!userNameDiv) {
            console.warn("------>>> failed to find user name in tweet cell div")
            return;
        }
        const user = parseNameFromTweetCell(userNameDiv);
        console.log('------>>> tweet user:', user.nameVal());

    })
}

function changeFilterType(category: string, elmItem: HTMLElement) {
    setCurrentCategory(category);

    document.querySelectorAll(".category-filter-item").forEach((elm) => {
        elm.classList.remove("active");
    })
    elmItem.classList.add("active");

    filterTweetsByCategory(category)
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

export function parseNameFromTweetCell(userNameDiv: HTMLElement): TweetUser {
    const link = userNameDiv.querySelector('a[role="link"]') as HTMLAnchorElement;
    const userHref = link?.getAttribute('href') || '';
    const username = userHref.startsWith('/') ? userHref.substring(1) : userHref;

    // 获取显示的用户名称文本（如 "Ian Miles Cheong"）
    const nameSpan = link?.querySelector('span span');
    const displayName = nameSpan?.textContent || '';

    return new TweetUser(username, displayName);
}