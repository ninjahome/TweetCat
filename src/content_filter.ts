import {curCategories, kolsInActiveCategory, setCurrentCategory} from "./category";
import {sendMsgToService} from "./utils";
import {Category, maxElmFindTryTimes, MsgType, TweetKol} from "./consts";
import {contentTemplate} from "./content";

async function appendFilterBtnToHomePage(navElement: HTMLElement) {

    const filterContainerDiv = contentTemplate.content.getElementById("category-filter-container");
    const filterBtn = contentTemplate.content.getElementById("category-filter-item");
    const moreBtn = contentTemplate.content.getElementById("category-filter-more");
    const clearBtn = contentTemplate.content.getElementById("category-filter-clear");

    if (!filterContainerDiv || !filterBtn || !moreBtn || !clearBtn) {
        console.error(`------>>> failed to filter buttons container is ${filterContainerDiv} category button is ${filterBtn} clear button is ${clearBtn}`);
        return;
    }
    const categories = curCategories();
    if (!categories || categories.length == 0) {
        console.log("------>>> no categories loaded now");
        return;
    }

    console.log("------->>> categories:", categories);

    navElement.parentElement!.appendChild(filterContainerDiv);

    clearBtn.querySelector(".category-filter-clear-btn")!.addEventListener("click", resetCategories)
    filterContainerDiv.appendChild(clearBtn);


    categories.forEach((category) => {
        const cloneItem = filterBtn.cloneNode(true) as HTMLElement;
        cloneItem.id = "category-filter-item-" + category;
        const btn = cloneItem.querySelector(".category-filter-btn") as HTMLElement
        btn.innerText = category.name;
        btn.addEventListener('click', () => {
            changeFilterType(category, cloneItem);
        });
        filterContainerDiv.appendChild(cloneItem);
    });

    moreBtn.querySelector(".category-filter-more-btn")!.addEventListener('click', addMoreCategory);
    filterContainerDiv.appendChild(moreBtn);
    console.log("------>>> add filter container success")
}

async function filterTweetsByCategory() {
    const kolNameInCategory = kolsInActiveCategory()
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
        }
    })
}

function changeFilterType(category: Category, elmItem: HTMLElement) {
    setCurrentCategory(category.id);

    document.querySelectorAll(".category-filter-item").forEach(elm => elm.classList.remove("active"));
    elmItem.classList.add("active");

    filterTweetsByCategory().then();
}

async function addMoreCategory() {
    await sendMsgToService("#onboarding/main-home", MsgType.OpenPlugin);
}


let isCheckingFilterBtn = false;
let naviTryTime = 0;

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

        await appendFilterBtnToHomePage(navElement);
    } finally {
        isCheckingFilterBtn = false;  // 确保执行完成后恢复标记
    }
}

export function parseNameFromTweetCell(tweetNode: HTMLElement): TweetKol | null {
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

    return new TweetKol(username, displayName);
}

function resetCategories() {
    setCurrentCategory(0);
    document.querySelectorAll(".category-filter-item").forEach(elm => elm.classList.remove("active"));
    window.location.reload();
}
