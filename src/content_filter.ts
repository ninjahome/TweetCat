import {observeForElement, sendMsgToService} from "./utils";
import {Category, defaultAllCategoryID, maxElmFindTryTimes, MsgType, TweetKol} from "./consts";
import {curPageIsHome, parseContentHtml, parseNameFromTweetCell} from "./content";
import {queryCategoriesFromBG} from "./category";
import {queryKolDetailByName, showPopupMenu} from "./content_oberver";

export let _curKolFilter = new Map<string, TweetKol>();
let _curFilterID = -1;
let isCheckingContainer = false;

async function appendFilterBtnToHomePage(navElement: HTMLElement, categories: Category[]) {
    const contentTemplate = await parseContentHtml('html/content.html');
    const filterContainerDiv = contentTemplate.content.getElementById("category-filter-container");
    const filterBtn = contentTemplate.content.getElementById("category-filter-item");
    const moreBtn = contentTemplate.content.getElementById("category-filter-more");
    const allCatBtn = contentTemplate.content.getElementById("category-filter-clear");

    if (!filterContainerDiv || !filterBtn || !moreBtn || !allCatBtn) {
        console.error(`------>>> failed to filter buttons container is ${filterContainerDiv}
         category button is ${filterBtn} clear button is ${allCatBtn}`);
        return;
    }

    navElement.parentElement!.appendChild(filterContainerDiv);

    allCatBtn.querySelector(".category-filter-clear-btn")!.addEventListener("click", resetCategories)
    allCatBtn.dataset.categoryID = '' + defaultAllCategoryID;
    filterContainerDiv.appendChild(allCatBtn);

    categories.forEach((category) => {
        const cloneItem = filterBtn.cloneNode(true) as HTMLElement;
        cloneItem.id = "category-filter-item-" + category.id;
        cloneItem.dataset.categoryID = '' + category.id
        const btn = cloneItem.querySelector(".category-filter-btn") as HTMLElement
        btn.innerText = category.catName;
        btn.addEventListener('click', async () => {
            await changeFilterType(category);
        });
        filterContainerDiv.appendChild(cloneItem);
    });

    moreBtn.querySelector(".category-filter-more-btn")!.addEventListener('click', addMoreCategory);
    filterContainerDiv.appendChild(moreBtn);
    console.log("------>>> add filter container success")
    setSelectedCategory();
}

async function filterTweetsByCategory() {
    if (_curKolFilter.size === 0) {
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

        if (_curKolFilter.has(user.kolName)) {
            console.log('------>>> tweet hint:', user.displayString());
        } else {
            console.log('------>>> tweet missed:', user.displayString());
            tweetNode.style.display = "none";
        }
    })
}

async function changeFilterType(category: Category) {

    const filter = await queryFilterFromBG(category.id!);
    if (filter.size === 0) {
        alert("no kols to apply this category");//TODO::
        return;
    }

    _curKolFilter = filter;
    _curFilterID = category.id!;

    setSelectedCategory();
    await filterTweetsByCategory();
}

export function setSelectedCategory() {
    document.querySelectorAll(".category-filter-item").forEach(elm => {
            elm.classList.remove("active");
            const emlCatID = Number((elm as HTMLElement).dataset.categoryID);
            if (emlCatID === _curFilterID) {
                elm.classList.add("active");
            }
        }
    );
}

async function addMoreCategory() {
    await sendMsgToService("#onboarding/main-home", MsgType.OpenPlugin);
}

export async function appendCategoryContainerAtTop() {
    if (isCheckingContainer || !curPageIsHome) {
        console.log('------>>> checkFilterBtn is already running or no need ');
        return;
    }

    isCheckingContainer = true;
    try {
        const navElement = document.querySelector('div[aria-label="Home timeline"] nav[role="navigation"]') as HTMLElement;
        if (!navElement) {
            observeForElement(document.body, 300, () => {
                return document.querySelector('div[aria-label="Home timeline"] nav[role="navigation"]') as HTMLElement;
            }, async () => {
                await appendCategoryContainerAtTop();
            }, false);
            return;
        }

        let filterContainerDiv = navElement.parentElement!.querySelector(".category-filter-container") as HTMLElement;
        if (filterContainerDiv) {
            console.log("------>>> no need to append filter container again");
            return;
        }

        const categories = await queryCategoriesFromBG();
        if (categories.length == 0) {
            console.log("------>>> no categories loaded now");
            return;
        }

        await appendFilterBtnToHomePage(navElement, categories);
    } finally {
        isCheckingContainer = false;  // 确保执行完成后恢复标记
    }
}

export function resetCategories() {

    if (_curFilterID <= 0) {
        return;
    }

    _curFilterID = defaultAllCategoryID;
    _curKolFilter = new Map<string, TweetKol>();
    setSelectedCategory();
    (document.querySelector('a[aria-label="Home"]') as HTMLElement)?.click();
}

async function queryFilterFromBG(catID: number): Promise<Map<string, TweetKol>> {
    const rsp = await sendMsgToService(catID, MsgType.QueryKolByCatID)
    if (!rsp.success) {
        console.log("------>>> load filter error:", rsp.data);
        return new Map<string, TweetKol>();
    }
    return new Map(rsp.data);
}

export async function reloadCategoryContainer(categories: Category[]) {
    const navElement = document.querySelector('div[aria-label="Home timeline"] nav[role="navigation"]') as HTMLElement;
    let filterContainerDiv = navElement.parentElement!.querySelector(".category-filter-container") as HTMLElement;
    if (filterContainerDiv) {
        filterContainerDiv.remove();
    }
    await appendFilterBtnToHomePage(navElement, categories);
}

let observing = false;
export async function appendFilterOnKolProfileHome(kolName: string) {
    if (observing){
        return;
    }

    observing = true;
    observeForElement(document.body, 800, () => {
        return document.querySelector(".css-175oi2r.r-obd0qt.r-18u37iz.r-1w6e6rj.r-1h0z5md.r-dnmrzs") as HTMLElement
    }, async () => {
        const profileToolBarDiv = document.querySelector(".css-175oi2r.r-obd0qt.r-18u37iz.r-1w6e6rj.r-1h0z5md.r-dnmrzs") as HTMLElement
        const oldFilterBtn = profileToolBarDiv.querySelectorAll(".filter-btn-on-profile");
        oldFilterBtn.forEach(item=>item.remove());
        await _appendFilterBtn(profileToolBarDiv, kolName)
        observing = false;
    }, false);
}

async function _appendFilterBtn(toolBar: HTMLElement, kolName: string) {
    const contentTemplate = await parseContentHtml('html/content.html');
    const menuBtn = contentTemplate.content.getElementById("filter-btn-on-profile") as HTMLElement;

    const clone = menuBtn.cloneNode(true) as HTMLElement;
    clone.setAttribute('id', "");
    toolBar.insertBefore(clone, toolBar.firstChild);
    clone.onclick = async (e) => {
        const categories = await queryCategoriesFromBG();
        if (categories.length === 0) {
            alert("no valid categories");//TODO::
            return;
        }
        let kol = await queryKolDetailByName(kolName);
        if (!kol) {
            const userNameDiv = document.querySelector(
                'div.css-175oi2r.r-18u37iz.r-1w6e6rj.r-6gpygo.r-14gqq1x[data-testid="UserName"]'
            );
            const displayNameDiv = userNameDiv?.querySelector(".css-1jxf684.r-bcqeeo.r-1ttztb7.r-qvutc0.r-poiln3")
            let displayName = displayNameDiv?.textContent?.trim() ?? "TweetCat";
            kol = new TweetKol(kolName, displayName);
        }

        if (!kol.avatarUrl) {
            const avatarUrl = document.querySelector('img[alt="Opens profile photo"]')?.getAttribute('src');
            if (!!avatarUrl) {
                console.log("------>>> avatar url found:", avatarUrl);
                kol.avatarUrl = avatarUrl;
            }
        }

        showPopupMenu(e, clone, categories, kol);
    }
}