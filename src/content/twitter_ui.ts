import {observeForElement} from "../common/utils";
import {choseColorByID} from "../common/consts";
import {parseContentHtml} from "./main_entrance";
import {queryKolDetailByName, showPopupMenu} from "./twitter_observer";
import {TweetKol, updateKolIdToSw} from "../object/tweet_kol";
import {queryCategoriesFromBG, queryCategoryById} from "../object/category";
import {getUserIdByUsername} from "../timeline/twitter_api";
import {getTweetCatFlag, navigateToTweetCat} from "../timeline/route_helper";
import {logTPR} from "../common/debug_flags";

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

    observeForElement(document.body, 30, () => {
        return document.querySelector('[data-testid="app-bar-back"]') as HTMLElement
    }, async () => {
        hijackBackButton();
    }, false);
}


function hijackBackButton(): void {
    const shouldReturnToTweetCat = getTweetCatFlag();
    if (!shouldReturnToTweetCat) return;

    const backButton = document.querySelector('[data-testid="app-bar-back"]');
    if (!backButton) return;

    let count = (backButton as any).__tc_click_count;

    // 如果已经初始化过 → 自增并返回
    if (count != null) {
        count++;
        (backButton as any).__tc_click_count = count;
        logTPR(`[TC] hijackBackButton 更新，当前计数: ${count}`);
        return;
    }

    // ===== 第一次初始化 =====
    (backButton as any).__tc_click_count = 1;

    backButton.addEventListener(
        "click",
        (e) => {
            e.preventDefault();
            e.stopPropagation();

            let c = (backButton as any).__tc_click_count;
            c--;
            (backButton as any).__tc_click_count = c;

            if (c <= 0) {
                logTPR("[TC] 最后一次返回 → 跳转 TweetCat");
                navigateToTweetCat();
            } else {
                logTPR(`[TC] 返回按钮 → history.back()，剩余计数: ${c}`);
                window.history.back();
            }
        },
        true
    );

    logTPR(`[TC] hijackBackButton 初始化，计数 = 1`);
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
        logTPR("------>>> avatar url found:[", kol.avatarUrl, "]for kol:", kol.kolName);
        needUpDateKolData = !!kol.avatarUrl
    }

    if (!kol.kolUserId) {
        kol.kolUserId = await getUserIdByUsername(kol.kolName) ?? "";
        needUpDateKolData = !!kol.kolUserId
        logTPR("------>>> need to load kol user id by tweet api:", kol.kolName, "found user id:", kol.kolUserId);
    }

    if (!needUpDateKolData) {
        return;
    }

    await updateKolIdToSw(kol);
    logTPR("------>>> update kol data success", kol)
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

