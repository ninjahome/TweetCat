import {sendMsgToService} from "./utils";
import {Category, defaultUserName, maxElmFindTryTimes, MsgType} from "./consts";
import {parseContentHtml, parseNameFromTweetCell} from "./content";

export let _curKolFilter = new Map<string, boolean>();
let _curFilterID = -1;
let isCheckingFilterBtn = false;
let naviTryTime = 0;

async function appendFilterBtnToHomePage(navElement: HTMLElement, categories: Category[]) {
    const contentTemplate = await parseContentHtml('html/content.html');
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

    categories.forEach((category) => {
        const cloneItem = filterBtn.cloneNode(true) as HTMLElement;
        cloneItem.id = "category-filter-item-" + category;
        const btn = cloneItem.querySelector(".category-filter-btn") as HTMLElement
        btn.innerText = category.catName;
        btn.addEventListener('click', async () => {
            await changeFilterType(category, cloneItem);
        });
        filterContainerDiv.appendChild(cloneItem);
    });

    moreBtn.querySelector(".category-filter-more-btn")!.addEventListener('click', addMoreCategory);
    filterContainerDiv.appendChild(moreBtn);
    console.log("------>>> add filter container success")
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

        if (_curKolFilter.has(user.userName)) {
            console.log('------>>> tweet hint:', user.nameVal());
        } else {
            console.log('------>>> tweet missed:', user.nameVal());
            tweetNode.style.display = "none";
        }
    })
}

async function changeFilterType(category: Category, elmItem: HTMLElement) {

    const filter = await queryFilterFromBG(category.id!);
    if (filter.size === 0) {
        alert("no kols to apply this category");//TODO::
        return;
    }

    _curKolFilter = filter;
    _curFilterID = category.id!;

    document.querySelectorAll(".category-filter-item").forEach(elm => elm.classList.remove("active"));
    elmItem.classList.add("active");
    await filterTweetsByCategory();
}

async function addMoreCategory() {
    await sendMsgToService("#onboarding/main-home", MsgType.OpenPlugin);
}

export async function prepareFilterBtn() {
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
                await prepareFilterBtn();
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
        isCheckingFilterBtn = false;  // 确保执行完成后恢复标记
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

async function queryFilterFromBG(catID: number): Promise<Map<string, boolean>> {
    const rsp = await sendMsgToService(catID, MsgType.QueryKolByCatID)
    if (!rsp.success) {
        console.log("------>>> load filter error:", rsp.data);
        return new Map<string, boolean>();
    }
    return new Map(rsp.data);
}

async function queryCategoriesFromBG(): Promise<Category[]> {
    const rsp = await sendMsgToService(defaultUserName, MsgType.QueryCatsByUser)
    if (!rsp.success) {
        console.log("------>>> load categories error:", rsp.data);
        return [];
    }
    return rsp.data as Category[];
}

export async function reloadCategoryContainer(categories: Category[]) {
    const navElement = document.querySelector('div[aria-label="Home timeline"] nav[role="navigation"]') as HTMLElement;
    let filterContainerDiv = navElement.parentElement!.querySelector(".category-filter-container") as HTMLElement;
    if (filterContainerDiv) {
        filterContainerDiv.remove();
    }
    await appendFilterBtnToHomePage(navElement, categories);
}