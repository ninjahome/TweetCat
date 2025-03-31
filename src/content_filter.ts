import {sendMsgToService} from "./utils";
import {Category, maxElmFindTryTimes, MsgType, TweetKol} from "./consts";
import {curPageIsHome, parseContentHtml, parseNameFromTweetCell} from "./content";
import {queryCategoriesFromBG} from "./category";
import {queryKolDetailByName, showPopupMenu} from "./content_oberver";

export let _curKolFilter = new Map<string, TweetKol>();
let _curFilterID = -1;
let isCheckingContainer = false;
let naviTryTime = 0;
let profileTryTime = 0;

async function appendFilterBtnToHomePage(navElement: HTMLElement, categories: Category[]) {
    const contentTemplate = await parseContentHtml('html/content.html');
    const filterContainerDiv = contentTemplate.content.getElementById("category-filter-container");
    const filterBtn = contentTemplate.content.getElementById("category-filter-item");
    const moreBtn = contentTemplate.content.getElementById("category-filter-more");
    const clearBtn = contentTemplate.content.getElementById("category-filter-clear");

    if (!filterContainerDiv || !filterBtn || !moreBtn || !clearBtn) {
        console.error(`------>>> failed to filter buttons container is ${filterContainerDiv}
         category button is ${filterBtn} clear button is ${clearBtn}`);
        return;
    }

    navElement.parentElement!.appendChild(filterContainerDiv);

    clearBtn.querySelector(".category-filter-clear-btn")!.addEventListener("click", resetCategories)
    filterContainerDiv.appendChild(clearBtn);

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
            console.log("------>>> home navigation div not found");
            naviTryTime += 1;
            if (naviTryTime > maxElmFindTryTimes) {
                console.warn("------>>> failed to find home navigation!");
                naviTryTime = 0;
                return;
            }
            setTimeout(async () => {
                await appendCategoryContainerAtTop();
            }, 3000);
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

function resetCategories() {

    if (_curFilterID <= 0) {
        return;
    }

    _curFilterID = -1;
    document.querySelectorAll(".category-filter-item").forEach(elm => elm.classList.remove("active"));
    window.location.reload();
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

export async function appendFilterOnKolProfileHome(kolName: string) {
    const profileToolBarDiv = document.querySelector(".css-175oi2r.r-obd0qt.r-18u37iz.r-1w6e6rj.r-1h0z5md.r-dnmrzs") as HTMLElement
    if (!profileToolBarDiv) {
        console.log("------>>> need try later to find profile tool bar!");
        profileTryTime += 1;
        if (profileTryTime > maxElmFindTryTimes) {
            console.warn("------>>> failed to find profile tool bar!");
            profileTryTime = 0;
            return;
        }
        setTimeout(async () => {
            await appendFilterOnKolProfileHome(kolName);
        }, 3000);

        return;
    }

    if (!!profileToolBarDiv.querySelector(".filter-btn-on-profile")) {
        console.log("------>>> filter button already appended")
        return;
    }
    const contentTemplate = await parseContentHtml('html/content.html');
    const menuBtn = contentTemplate.content.getElementById("filter-btn-on-profile") as HTMLElement;

    const clone = menuBtn.cloneNode(true) as HTMLElement;
    clone.setAttribute('id', "");
    profileToolBarDiv.insertBefore(clone, profileToolBarDiv.firstChild);
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
            const displayName = displayNameDiv?.textContent?.trim()
            if (!displayName) {
                alert("failed to parse kol name");
                return;
            }
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