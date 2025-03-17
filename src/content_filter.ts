import browser from "webextension-polyfill";
import {activeCategory, getCategoryKeys, setCurrentCategory} from "./content_category";
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

    let filterContainerDiv = navElement.parentElement!.querySelector(".category-filter-container");
    if (filterContainerDiv) {
        console.log("------>>> no need to append filter container again");
        return;
    }

    const template = await parseContentHtml('html/content.html');
    filterContainerDiv = template.content.getElementById("category-filter-container");
    const filterBtn = template.content.getElementById("category-filter-item");
    const moreBtn = template.content.getElementById("category-filter-more");
    const clearBtn = template.content.getElementById("category-filter-clear");

    if (!filterContainerDiv || !filterBtn || !moreBtn || !clearBtn) {
        console.error(`------>>> failed to filter buttons container is ${filterContainerDiv} category button is ${filterBtn} clear button is ${clearBtn}`);
        return;
    }

    navElement.parentElement!.appendChild(filterContainerDiv);

    clearBtn.querySelector(".category-filter-clear-btn")!.addEventListener("click", resetCategories)
    filterContainerDiv.appendChild(clearBtn);

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
    console.log("------>>> add filter container success")
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

function filterTweetsByCategory() {

    const kolNameInCategory = activeCategory()
    if (!kolNameInCategory) {
        console.log("------>>> no active category selected");
        return;
    }

    const tweetsContainer = document.querySelector('div[aria-label="Timeline: Your Home Timeline"]') as HTMLElement;
    if (!tweetsContainer) {
        console.warn("------>>> failed to find tweet container when starting to filter")
        return;
    }

    tweetsContainer.querySelectorAll('div[data-testid="cellInnerDiv"]').forEach(node => {
        const tweetNode = node as HTMLElement;
        const user = parseNameFromTweetCell(tweetNode);
        if (!user) {
            console.log("------>>> failed parse user name:", node);
            return
        }

        if (kolNameInCategory.has(user.userName)) {
            console.log('------>>> tweet hint:', user.nameVal());
        } else {
            console.log('------>>> tweet missed:', user.nameVal());
            tweetNode.style.display = "none";
            // tweetNode.dataset.tag = tweetFilteredTag;
        }
    })
}

function changeFilterType(category: string, elmItem: HTMLElement) {
    setCurrentCategory(category);

    document.querySelectorAll(".category-filter-item").forEach(elm => elm.classList.remove("active"));
    elmItem.classList.add("active");

    filterTweetsByCategory()
}

async function addMoreCategory() {
    await sendMsgToService("#onboarding/category-manager", MsgType.OpenPlugin);
}

export async function checkFilterBtn() {
    await appendFilterBtnToHomePage();
}

export function parseNameFromTweetCell(tweetNode: HTMLElement): TweetUser | null {
    const userNameDiv = tweetNode.querySelector('div[data-testid="User-Name"] a[role="link"]') as HTMLElement;

    if (!userNameDiv) {
        return null;
    }

    const userHref = userNameDiv?.getAttribute('href') || '';
    const username = userHref.startsWith('/') ? userHref.substring(1) : userHref;

    const nameSpan = userNameDiv.querySelector(".css-1jxf684.r-bcqeeo.r-1ttztb7.r-qvutc0.r-poiln3") as HTMLElement
    const displayName = nameSpan?.textContent || '';
    if (!username || !displayName) {
        return null;
    }

    return new TweetUser(username, displayName);
}

function resetCategories() {
    setCurrentCategory("");
    document.querySelectorAll(".category-filter-item").forEach(elm => elm.classList.remove("active"));

    // const selector = `[data-tag="${tweetFilteredTag}"]`;
    // const elements = document.querySelectorAll<HTMLElement>(selector);
    // elements.forEach(node=>node.style.display='flex');
    window.location.reload();
}