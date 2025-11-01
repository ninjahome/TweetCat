import {observeForElement} from "../common/utils";
import {choseColorByID} from "../common/consts";
import {parseContentHtml} from "./main_entrance";
import {queryKolDetailByName, showPopupMenu} from "./twitter_observer";
import {TweetKol, updateKolIdToSw} from "../object/tweet_kol";
import {queryCategoriesFromBG, queryCategoryById} from "../object/category";
import {getUserIdByUsername} from "../timeline/twitter_api";
import {logTPR} from "../common/debug_flags";
import {calculateLevelBreakdown, LevelScoreBreakdown, UserProfile} from "../object/user_info";

let observing = false;

export async function appendFilterOnKolProfilePage(kolName: string) {
    if (observing) {
        return;
    }

    observing = true;
    observeForElement(document.body, 800, () => {
        return document.querySelector(".css-175oi2r.r-obd0qt.r-18u37iz.r-1w6e6rj.r-1h0z5md.r-dnmrzs") as HTMLElement
    }, async (profileToolBarDiv) => {
        const oldFilterBtn = profileToolBarDiv.querySelectorAll(".filter-btn-on-profile");
        oldFilterBtn.forEach(item => item.remove());
        await _appendFilterBtn(profileToolBarDiv, kolName);
        observing = false;
    }, false);
}

const kolScoreCache = new Map<string, LevelScoreBreakdown>();

export async function appendScoreInfoToProfilePage(profileData: any, userName: string) {

    console.log("[injection fetched data]------>>>screen name：", userName, "\n raw data:", profileData);
    try {
        const usrProfile = new UserProfile(profileData);
        const scoreData = calculateLevelBreakdown(usrProfile);
        console.log("------>>> score data:", scoreData);
        kolScoreCache.set(userName, scoreData);

        const avatarArea = document.querySelector(`div[data-testid="UserAvatar-Container-${usrProfile.userName}"]`)

        let scoreDiv = document.getElementById("user-profile-score") as HTMLElement;
        if (scoreDiv){

        }else{
           const tpl =  await parseContentHtml("html/content.html") ;
            scoreDiv = tpl.content.getElementById("user-profile-score")?.cloneNode(true) as HTMLElement;
            avatarArea?.insertAdjacentElement('afterend', scoreDiv);
        }

        (scoreDiv.querySelector(".total-score-value") as HTMLElement).innerText = "" + scoreData.total;

        const scoreDetailDiv = document.getElementById("user-profile-score-details") as HTMLElement;
        if(!scoreDetailDiv)return;

        scoreDiv.addEventListener("mouseenter", () => {
            scoreDetailDiv.style.display = "block";
            const rect = scoreDiv.getBoundingClientRect();
            scoreDetailDiv.style.position = "absolute";
            scoreDetailDiv.style.top = rect.top + window.scrollY - scoreDetailDiv.offsetHeight - 8 + "px";
            scoreDetailDiv.style.left = rect.left + window.scrollX + "px";
        });

        scoreDiv.addEventListener("mouseleave", () => {
            scoreDetailDiv.style.display = "none";
        });

        (scoreDetailDiv.querySelector(".scale-score-value") as HTMLElement).innerText = scoreData.scale.toFixed(3);
        (scoreDetailDiv.querySelector(".activity-score-value") as HTMLElement).innerText = scoreData.activity.toFixed(3);
        (scoreDetailDiv.querySelector(".trust-score-value") as HTMLElement).innerText = scoreData.trust.toFixed(3);
        (scoreDetailDiv.querySelector(".brand-score-value") as HTMLElement).innerText = scoreData.brand.toFixed(3);
        (scoreDetailDiv.querySelector(".growth-score-value") as HTMLElement).innerText = scoreData.growth.toFixed(3);

    } catch (e) {
        console.warn("failed to append score data to profile page.", e, userName);
    }
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

    // 没有 kol 或没有 catID → 未分类
    if (!kol || !kol.catID) {
        buttonDiv.style.display = 'flex';   // profile 页默认布局
        nameDiv.style.display = 'none';
        return;
    }

    const cat = await queryCategoryById(kol.catID!);
    if (!cat) {
        // 分类被删除或无效 → 也当作未分类
        buttonDiv.style.display = 'flex';
        nameDiv.style.display = 'none';
        console.log("category not found or invalid for kol", kol);
        return;
    }

    // 正常分类展示
    buttonDiv.style.display = 'none';
    nameDiv.style.display = 'block';
    (nameDiv.querySelector(".dot") as HTMLElement).style.backgroundColor = choseColorByID(kol.catID!);
    nameDiv.querySelector(".category-name")!.textContent = cat.catName;
}
