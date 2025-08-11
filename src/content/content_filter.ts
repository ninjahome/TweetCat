import {observeForElement, sendMsgToService} from "../common/utils";
import {choseColorByID, defaultAllCategoryID, MsgType} from "../common/consts";
import {parseContentHtml} from "./content";
import {queryKolDetailByName, showPopupMenu} from "./content_oberver";
import {TweetKol} from "../object/tweet_kol";
import {queryCategoriesFromBG, queryCategoryById} from "../object/category";
import {getUserIdByUsername} from "../timeline/twitter_api";
import {getTweetCatFlag, isInTweetCatRoute, navigateToTweetCat} from "../timeline/route_helper";
import {switchCategory} from "../timeline/timeline_ui";
import {EntryObj} from "../timeline/tweet_entry";

export function setSelectedCategory(catID: number = -1) {
    document.querySelectorAll(".category-filter-item").forEach(elm => {
            elm.classList.remove("active");
            const emlCatID = Number((elm as HTMLElement).dataset.categoryID);
            if (emlCatID === catID) {
                elm.classList.add("active");
            }
        }
    );
}


let observing = false;

export async function appendFilterOnKolProfileHome(kolName: string) {
    if (observing) {
        return;
    }

    observing = true;
    observeForElement(document.body, 800, () => {
        return document.querySelector(".css-175oi2r.r-obd0qt.r-18u37iz.r-1w6e6rj.r-1h0z5md.r-dnmrzs") as HTMLElement
    }, async (profileToolBarDiv) => {
        const oldFilterBtn = profileToolBarDiv.querySelectorAll(".filter-btn-on-profile");
        oldFilterBtn.forEach(item => item.remove());
        await _appendFilterBtn(profileToolBarDiv, kolName)
        hijackBackButton();
        observing = false;
    }, false);
}

export async function appendFilterOnTweetPage(kolName?: string) {
    if (!kolName) return;

    observeForElement(document.body, 1000, () => {
        return document.querySelector('[data-testid="app-bar-back"]') as HTMLElement
    }, async () => {
        hijackBackButton();
    }, false);
}

function hijackBackButton(): void {
    const backButton = document.querySelector('[data-testid="app-bar-back"]');
    if (!backButton) return;

    if ((backButton as any).__tc_back_hooked) return;
    (backButton as any).__tc_back_hooked = true;

    backButton.addEventListener('click', (e) => {
        const shouldReturnToTweetCat = getTweetCatFlag();
        const notInTweetCat = !isInTweetCatRoute();
        if (!(shouldReturnToTweetCat && notInTweetCat)) return;

        e.preventDefault();
        e.stopPropagation();
        console.debug('[TC] 拦截返回按钮，跳转回 TweetCat');
        navigateToTweetCat();
    }, true); // 使用 capture 模式，优先于 React/Twitter 默认处理
}


async function _appendFilterBtn(toolBar: HTMLElement, kolName: string) {
    const contentTemplate = await parseContentHtml('html/content.html');
    const menuBtn = contentTemplate.content.getElementById("filter-btn-on-profile") as HTMLElement;

    const clone = menuBtn.cloneNode(true) as HTMLElement;
    clone.setAttribute('id', "");
    await setCategoryStatusOnProfileHome(kolName, clone)
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

        _kolCompletion(kol).then()

        showPopupMenu(e, clone, categories, kol, setCategoryStatusOnProfileHome);
    }
}

async function _kolCompletion(kol: TweetKol) {
    let needUpDateKolData = false;
    if (!kol.avatarUrl) {
        kol.avatarUrl = document.querySelector('div[data-testid="primaryColumn"] div[data-testid^="UserAvatar-Container-"] img')?.getAttribute('src') ?? "";
        console.log("------>>> avatar url found:[", kol.avatarUrl, "]for kol:", kol.kolName);
        needUpDateKolData = !!kol.avatarUrl
    }

    if (!kol.kolUserId) {
        kol.kolUserId = await getUserIdByUsername(kol.kolName) ?? "";
        needUpDateKolData = !!kol.kolUserId
        console.log("------>>> need to load kol user id by tweet api:", kol.kolName, "found user id:", kol.kolUserId);
    }

    if (!needUpDateKolData) {
        return;
    }

    await sendMsgToService(kol, MsgType.KolUpdate);
    console.log("------>>> update kol data success", kol)
}

async function setCategoryStatusOnProfileHome(kolName: string, clone: HTMLElement) {
    let kol = await queryKolDetailByName(kolName);
    const buttonDiv = clone.querySelector('.noCategory') as HTMLElement;
    const nameDiv = clone.querySelector(".hasCategory") as HTMLElement;
    if (!kol) {
        buttonDiv.style.display = 'flex';
        nameDiv.style.display = 'none';
    } else {
        buttonDiv.style.display = 'none';
        nameDiv.style.display = 'block';
        const cat = await queryCategoryById(kol.catID!);
        if (!!cat) {
            (nameDiv.querySelector(".dot") as HTMLElement).style.backgroundColor = choseColorByID(kol.catID!);
            nameDiv.querySelector(".category-name")!.textContent = cat.catName;
        }
    }
}


export async function appendFilterBtn(tpl: HTMLTemplateElement, main: HTMLElement) {
    const filterContainerDiv = tpl.content.getElementById("category-filter-container");
    const filterBtn = tpl.content.getElementById("category-filter-item");
    const moreBtn = tpl.content.getElementById("category-filter-more");
    const allCatBtn = tpl.content.getElementById("category-filter-clear");

    if (!filterContainerDiv || !filterBtn || !moreBtn || !allCatBtn) {
        console.error(`------>>> failed to filter buttons container is ${filterContainerDiv}
         category button is ${filterBtn} clear button is ${allCatBtn}`);
        return;
    }
    const container = main.querySelector(".tweet-main .tweet-cat-filter-area") as HTMLElement
    if (!container) {
        console.warn("🚨------>>> failed to find tweet cat filter area");
        return
    }
    container.appendChild(filterContainerDiv);

    allCatBtn.querySelector(".category-filter-clear-btn")!.addEventListener("click", resetCategories)
    allCatBtn.dataset.categoryID = '' + defaultAllCategoryID;
    filterContainerDiv.appendChild(allCatBtn);

    const categories = await queryCategoriesFromBG();
    categories.forEach((category) => {
        const cloneItem = filterBtn.cloneNode(true) as HTMLElement;
        cloneItem.id = "category-filter-item-" + category.id;
        cloneItem.dataset.categoryID = '' + category.id
        const btn = cloneItem.querySelector(".category-filter-btn") as HTMLElement
        btn.innerText = category.catName;
        btn.addEventListener('click', async () => {
            await changeFilterType(category.id ?? null);
        });
        filterContainerDiv.appendChild(cloneItem);
    });

    moreBtn.querySelector(".category-filter-more-btn")!.addEventListener('click', addMoreCategory);
    filterContainerDiv.appendChild(moreBtn);
    console.log("✅ ------>>> add filter container success")
    setSelectedCategory();
}

async function addMoreCategory() {
    await sendMsgToService("#onboarding/main-home", MsgType.OpenPlugin);
}

async function resetCategories() {
    await switchCategory(null);
    setSelectedCategory(-1);
}

async function changeFilterType(catId: number | null) {
    await switchCategory(catId);
    setSelectedCategory(catId ?? -1);
}

export async function showNewestTweets(tweets:EntryObj[]){
    await switchCategory(null);
    setSelectedCategory(-1);
}

