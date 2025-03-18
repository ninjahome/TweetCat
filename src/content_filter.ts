import browser from "webextension-polyfill";
import {activeCategory, getCategoryKeys, setCurrentCategory} from "./content_category";
import {sendMsgToService} from "./utils";
import {maxElmFindTryTimes, MsgType, TweetUser} from "./consts";
import {contentTemplate} from "./content";

export async function prepareFilterHtmlElm() {
    addCustomStyles('css/content.css');
    await checkFilterBtn();
    translateInjectedElm();
}

async function appendFilterBtnToHomePage(navElement: HTMLElement) {

    const filterContainerDiv = contentTemplate.content.getElementById("category-filter-container");
    const filterBtn = contentTemplate.content.getElementById("category-filter-item");
    const moreBtn = contentTemplate.content.getElementById("category-filter-more");
    const clearBtn = contentTemplate.content.getElementById("category-filter-clear");

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

function translateInjectedElm() {
}

async function filterTweetsByCategory() {
    await fetchTweetFromBack(['elonmusk']);
    return;
    //
    // const kolNameInCategory = activeCategory()
    // if (!kolNameInCategory) {
    //     console.log("------>>> no active category selected");
    //     return;
    // }
    // const tweetsContainer = document.querySelector('div[aria-label="Timeline: Your Home Timeline"]') as HTMLElement;
    // if (!tweetsContainer) {
    //     console.warn("------>>> failed to find tweet container when starting to filter")
    //     return;
    // }
    // tweetsContainer.querySelectorAll('div[data-testid="cellInnerDiv"]').forEach(node => {
    //     const tweetNode = node as HTMLElement;
    //     const user = parseNameFromTweetCell(tweetNode);
    //     if (!user) {
    //         console.log("------>>> failed parse user name:", node);
    //         return
    //     }
    //
    //     if (kolNameInCategory.has(user.userName)) {
    //         console.log('------>>> tweet hint:', user.nameVal());
    //     } else {
    //         console.log('------>>> tweet missed:', user.nameVal());
    //         tweetNode.style.display = "none";
    //     }
    // })
}

function changeFilterType(category: string, elmItem: HTMLElement) {
    setCurrentCategory(category);

    document.querySelectorAll(".category-filter-item").forEach(elm => elm.classList.remove("active"));
    elmItem.classList.add("active");

    filterTweetsByCategory().then();
}

async function addMoreCategory() {
    await sendMsgToService("#onboarding/category-manager", MsgType.OpenPlugin);
}


let isCheckingFilterBtn = false;
let naviTryTime = 0;

export async function checkFilterBtn() {
    if (isCheckingFilterBtn) {
        console.log('------>>> checkFilterBtn is already running.');
        return;
    }

    isCheckingFilterBtn = true;
    try {
        const navElement = document.querySelector('div[aria-label="Home timeline"] nav[role="navigation"]') as HTMLElement;
        if (!navElement) {
            console.log("------>>> home navigation div not found");
            naviTryTime += 1;
            if (naviTryTime > maxElmFindTryTimes) {
                console.warn("------>>> failed to find home navigation!");
                naviTryTime = 0;
                return;
            }
            setTimeout(async () => {
                await checkFilterBtn();
            }, 3000);
            return;
        }

        let filterContainerDiv = navElement.parentElement!.querySelector(".category-filter-container");
        if (filterContainerDiv) {
            console.log("------>>> no need to append filter container again");
            return;
        }

        await appendFilterBtnToHomePage(navElement);


    } finally {
        isCheckingFilterBtn = false;  // 确保执行完成后恢复标记
    }
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
    window.location.reload();
}

async function fetchTweetFromBack(users: string[]) {
    const response = await sendMsgToService(users, MsgType.QueryKolTweets);
    if (!response.success) {
        console.log("------>>> failed to load tweets :", response.data);
        return;
    }
    console.log("------->>> load tweets success:", response.data);
}
