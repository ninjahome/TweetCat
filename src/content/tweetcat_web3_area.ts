import {sendMsgToService} from "../common/utils";
import {defaultAllCategoryID, MsgType} from "../common/consts";
import {EntryObj} from "../timeline/tweet_entry";
import {switchCategory} from "./tweetcat_timeline";
import {queryCategoriesFromBG} from "../object/category";
import {logTPR} from "../common/debug_flags";
import {getSessCatID} from "../timeline/tweet_pager";

export function setSelectedCategory(catID: number = defaultAllCategoryID) {
    document.querySelectorAll(".category-filter-item").forEach(elm => {
            elm.classList.remove("active");
            const emlCatID = Number((elm as HTMLElement).dataset.categoryID);
            if (emlCatID === catID) {
                elm.classList.add("active");
            }
        }
    );
}

export async function addMoreCategory() {
    await sendMsgToService("#onboarding/main-home", MsgType.OpenPlugin);
}

const onNewestNotificationClick = async (ev: Event) => {
    const notificationContainer = ev.currentTarget as HTMLElement;
    notificationContainer.style.display = "none";
    await switchCategory(defaultAllCategoryID);
    setSelectedCategory(defaultAllCategoryID);
};

export async function showNewestTweets(tweets: EntryObj[]) {
    const notificationContainer = document.querySelector(".new-tweet-notification") as HTMLElement;
    if (!notificationContainer) {
        console.warn("notificationContainer not found");
        return;
    }

    notificationContainer.removeEventListener("click", onNewestNotificationClick);
    notificationContainer.addEventListener("click", onNewestNotificationClick);

    notificationContainer.style.display = "block";
    const numberDiv = notificationContainer.querySelector(".tweet-no") as HTMLElement;
    numberDiv.innerText = '' + tweets.length;
}

export function resetNewestTweet() {
    const notificationContainer = document.querySelector(".new-tweet-notification") as HTMLElement;
    if (!notificationContainer) {
        console.warn("notificationContainer not found");
        return;
    }
    const numberDiv = notificationContainer.querySelector(".tweet-no") as HTMLElement;
    numberDiv.innerText = '';
    notificationContainer.style.display = "none";
}

export async function resetCategories() {
    await switchCategory(defaultAllCategoryID);
    setSelectedCategory(defaultAllCategoryID);
}

export async function changeFilterType(catId: number) {
    await switchCategory(catId);
    setSelectedCategory(catId);
}

export async function setupFilterItemsOnWeb3Area(tpl: HTMLTemplateElement, main: HTMLElement) {
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
            await changeFilterType(category.id ?? defaultAllCategoryID);
        });
        filterContainerDiv.appendChild(cloneItem);
    });

    moreBtn.querySelector(".category-filter-more-btn")!.addEventListener('click', addMoreCategory);
    filterContainerDiv.appendChild(moreBtn);
    logTPR("✅ ------>>> add filter container success")
    setSelectedCategory(getSessCatID());
}