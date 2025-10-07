import {parseNameFromTweetCell, parseContentHtml} from "./main_entrance";
import {__DBK_AD_Block_Key, choseColorByID, MsgType} from "../common/consts";
import {isAdTweetNode, parseTwitterPath, sendMsgToService} from "../common/utils";
import {localGet, localSet} from "../common/local_storage";
import {TweetKol, updateKolIdToSw} from "../object/tweet_kol";
import {Category, queryCategoriesFromBG, queryCategoryById} from "../object/category";
import {getUserIdByUsername} from "../timeline/twitter_api";
import {fetchImmediateInNextRound, videoParamForTweets} from "../timeline/tweet_fetcher";
import {logAD} from "../common/debug_flags";
import {blockedAdNumIncrease} from "../object/system_setting";
import {prepareDownloadBtn} from "../timeline/render_action";
import {t} from "../common/i18n";
import {showDialog} from "../timeline/render_common";

let __menuBtnDiv: HTMLElement;
let __categoryPopupMenu: HTMLElement;
let __blockAdStatus: boolean = false;
new Map<string, TweetKol>();

export function changeAdsBlockStatus(status: boolean) {
    console.log("------>>> change block ads settings:", status);

    __blockAdStatus = status;
    if (status) {
        (document.querySelectorAll('div[data-testid="cellInnerDiv"]') as NodeListOf<HTMLElement>).forEach(elm => {
            if (isAdTweetNode(elm, false)) {
                elm.style.display = 'none';
                logAD("------>>> remove ads at loaded", elm);
            }
        })
    }
    localSet(__DBK_AD_Block_Key, status ?? false).then();
}

const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
        if (mutation.addedNodes.length > 0) {
            filterTweets(mutation.addedNodes);
        }
    });
});


let _contentTemplate: HTMLTemplateElement | null = null;

export async function initObserver() {
    __blockAdStatus = await localGet(__DBK_AD_Block_Key) as boolean ?? false;

    observer.observe(document.body, {childList: true, subtree: true});

    const tpl = await parseContentHtml('html/content.html');

    __menuBtnDiv = tpl.content.getElementById("filter-menu-on-main") as HTMLElement;
    const popupMenu = tpl.content.getElementById("category-popup-menu") as HTMLElement;
    if (!__menuBtnDiv || !popupMenu) {
        console.warn(`------>>> failed to load filter menu ${__menuBtnDiv} ${__categoryPopupMenu}`);
        return;
    }

    __categoryPopupMenu = popupMenu.cloneNode(true) as HTMLElement;
    document.body.appendChild(__categoryPopupMenu);
    _contentTemplate = tpl;
}

function prepareVideoForTweetDetail(divNode: HTMLDivElement, mainTweetID: string) {
    const videoViews = divNode.querySelector('.css-175oi2r.r-1d09ksm.r-18u37iz.r-1wbh5a2.r-1471scf');
    if (!videoViews) {
        logAD("[Tweet Details] mainTweetID:", mainTweetID, " find video in tweet detail list");
        prepareVideoForTweetDiv(divNode);
        return;
    }

    const videoInfo = videoParamForTweets(mainTweetID);
    const actionMenuList = divNode.querySelector(".css-175oi2r.r-18u37iz.r-1h0z5md.r-13awgt0")?.parentElement as HTMLElement;
    if (!videoInfo) {
        logAD("[Tweet Details]mainTweetID:", mainTweetID, " no video now, try later:", divNode);
        setTimeout(() => tryVideoDownloadLater(actionMenuList, mainTweetID, divNode), 2_000);
        return;
    }

    logAD("[Tweet Details]mainTweetID:", mainTweetID, " videoInfo:", videoInfo, divNode);
    bindDownLoadBtn(actionMenuList, videoInfo.f, videoInfo.m, divNode);
}

function bindDownLoadBtn(actionMenuList: HTMLElement, fileName: string, mp4List: string[], hostDiv: HTMLElement) {
    if (!_contentTemplate) return;
    if (!actionMenuList) return;

    const downDiv = _contentTemplate.content.querySelector(".action-button.download")?.cloneNode(true) as HTMLElement;
    if (!downDiv) return;
    const btn = downDiv.querySelector(".downloadVideo") as HTMLSpanElement
    btn.style.display = 'none';
    prepareDownloadBtn(downDiv, fileName, mp4List, hostDiv);
    actionMenuList.appendChild(downDiv);
}

function tryVideoDownloadLater(actionMenuList: HTMLElement, tid: string, divNode: HTMLElement) {
    const videoInfo = videoParamForTweets(tid);
    if (!videoInfo) {
        logAD("【try video download again failed】statusId:", tid,);
        return;
    }

    logAD("【try video download again success】statusId:", tid, " videoInfo:", videoInfo);
    bindDownLoadBtn(actionMenuList, videoInfo.f, videoInfo.m, divNode);
}

function findTweetIDOfTweetDiv(divNode: HTMLDivElement) {
    const anchors = Array.from(divNode.querySelectorAll<HTMLAnchorElement>("a[href]"));
    const regex = /^\/[^/]+\/status\/(\d+)$/;

    let statusId: string | null = null;

    for (const a of anchors) {
        const href = a.getAttribute("href") || "";
        const match = href.match(regex);
        if (match) {
            statusId = match[1];
            break;
        }
    }

    return statusId;
}

function prepareVideoForTweetDiv(divNode: HTMLDivElement) {

    const statusId = findTweetIDOfTweetDiv(divNode);
    if (!statusId) return;

    const videoInfo = videoParamForTweets(statusId);
    logAD("【Tweet Timeline】statusId:", statusId, " videoInfo:", videoInfo);
    const actionMenuList = divNode.querySelector(".css-175oi2r.r-18u37iz.r-1h0z5md.r-13awgt0")?.parentElement as HTMLElement;
    if (!videoInfo) {
        logAD("[Tweet Timeline] no video info now, try later", statusId);
        setTimeout(() => tryVideoDownloadLater(actionMenuList, statusId, divNode), 2_000);
        return;
    }

    logAD("[Tweet Timeline] found video info:", statusId, videoInfo);
    bindDownLoadBtn(actionMenuList, videoInfo.f, videoInfo.m, divNode);
}

function filterTweets(nodes: NodeList) {
    const linkInfo = parseTwitterPath(window.location.href)
    nodes.forEach((divNode) => {
        // console.log("------>>> div node:", divNode);
        if (!isTweetDiv(divNode)) {
            // console.log("------>>> is home page:", window.location.href);
            return;
        }
        // console.log("------>>> tweet cell div node:", divNode, divNode.outerHTML);
        if (isAdTweetNode(divNode, true)) {
            logAD("------>>> found ads at startup", divNode);
            if (__blockAdStatus) {
                divNode.style.display = "none";
                blockedAdNumIncrease().then();
            }
            return;
        }

        if (linkInfo.kind === "home") {
            const user = parseNameFromTweetCell(divNode);
            appendCategoryMenuOnTweet(divNode, user).then();
        }
        if (linkInfo.kind === "home" || linkInfo.kind === "profile") {
            prepareVideoForTweetDiv(divNode);
        }

        if (linkInfo.kind === "tweet") {
            prepareVideoForTweetDetail(divNode, linkInfo.tweetId);
        }
    });
}

function isTweetDiv(node: Node): node is HTMLDivElement {
    return (
        node instanceof HTMLDivElement &&
        node.dataset.testid === 'cellInnerDiv'
    );
}


async function setCatMenu(kolName: string, clone: HTMLElement) {
    const catBtn = clone.querySelector('.noCategory') as HTMLElement;
    const catName = clone.querySelector(".hasCategory") as HTMLElement;

    let kol = await queryKolDetailByName(kolName);
    // 没有 kol 或没有 catID → 未分类
    if (!kol || !kol.catID) {
        catBtn.style.display = 'block';   // timeline 默认布局
        catName.style.display = 'none';
        return;
    }

    const cat = await queryCategoryById(kol.catID!);
    if (!cat) {
        // 分类被删除或无效 → 也当作未分类
        catBtn.style.display = 'block';
        catName.style.display = 'none';
        console.log("category not found or invalid for kol", kol);
        return;
    }

    // 正常分类展示
    catBtn.style.display = 'none';
    catName.style.display = 'block';
    (clone.querySelector(".dot") as HTMLElement).style.backgroundColor = choseColorByID(kol.catID!);
    catName.querySelector(".menu-item-category-name")!.textContent = cat.catName;
}


async function appendCategoryMenuOnTweet(tweetCellDiv: HTMLElement, rawKol: TweetKol | null) {
    if (!rawKol) return;
    const menuAreaDiv = tweetCellDiv.querySelector(".css-175oi2r.r-1awozwy.r-18u37iz.r-1cmwbt1.r-1wtj0ep") as HTMLElement
    if (!menuAreaDiv) {
        console.log("------>>> no menu area in this tweet cell:", tweetCellDiv);
        return;
    }

    if (!!menuAreaDiv.querySelector(".filter-menu-on-main")) {
        console.log("------>>> duplicate menu addition", menuAreaDiv);
        return;
    }

    const clone = __menuBtnDiv.cloneNode(true) as HTMLElement;
    clone.setAttribute('id', "");
    setCatMenu(rawKol.kolName, clone).then();
    menuAreaDiv.insertBefore(clone, menuAreaDiv.firstChild);

    clone.onclick = async (e) => {
        const categories = await queryCategoriesFromBG();
        if (categories.length === 0) {
            showDialog(t("warning"), t('no_valid_categories'))
            return;
        }

        let kol = await queryKolDetailByName(rawKol.kolName);
        if (!kol) {
            kol = new TweetKol(rawKol.kolName, rawKol.displayName);
        }
        _kolCompletion(kol, tweetCellDiv).then();

        showPopupMenu(e, clone, categories, kol, setCatMenu);
    };
}

async function _kolCompletion(kol: TweetKol, tweetCellDiv: HTMLElement) {
    let needUpDateKolData = false;
    if (!kol.avatarUrl) {
        needUpDateKolData = true
        kol.avatarUrl = getKolAvatarLink(tweetCellDiv) ?? "";
        // console.log("------>>>tweet cell avatar url link:", kol.avatarUrl);
    }

    if (!kol.kolUserId) {
        needUpDateKolData = true
        kol.kolUserId = await getUserIdByUsername(kol.kolName) ?? "";
    }

    if (!needUpDateKolData) {
        return;
    }
    await updateKolIdToSw(kol);
    console.log("------>>> update kol data success", kol)
}

export function showPopupMenu(event: MouseEvent, buttonElement: HTMLElement, categories: Category[], kol: TweetKol, callback?: (kolName: string, clone: HTMLElement) => Promise<void>) {
    event.stopPropagation();
    event.preventDefault();

    const rect = buttonElement.getBoundingClientRect();
    __categoryPopupMenu.style.top = `${rect.bottom + window.scrollY}px`;
    __categoryPopupMenu.style.left = `${rect.left + window.scrollX}px`;
    __categoryPopupMenu.style.display = 'block';

    const container = __categoryPopupMenu.querySelector(".category-item-container") as HTMLElement;
    const itemLi = __categoryPopupMenu.querySelector(".menu-item") as HTMLElement
    container.innerHTML = '';
    categories.forEach(cat => {
        const clone = _cloneMenuItem(itemLi, cat, kol);
        clone.onclick = async () => {
            await changeCategoryOfKol(clone, cat, kol);
            if (callback) {
                await callback(kol.kolName, buttonElement);
            }
            __categoryPopupMenu.style.display = 'none';
        };
        container.append(clone);
    });

    const removeBtn = __categoryPopupMenu.querySelector(".menu-item-remove") as HTMLElement;
    removeBtn.style.display = !!kol.catID ? 'block' : 'none';
    (removeBtn.firstElementChild as HTMLElement).innerText = t('remove_category');
    removeBtn.onclick = () => {
        sendMsgToService(kol.kolName, MsgType.KolRemove).then(async () => {
            __categoryPopupMenu.style.display = 'none';
            if (callback) {
                await callback(kol.kolName, buttonElement);
            }
            if (kol.kolUserId) sendMsgToService(kol.kolUserId, MsgType.TweetRemoveByKolID).then()
        });
    }

    document.addEventListener('click', handleClickOutside);
}


function handleClickOutside(evt: MouseEvent) {
    const target = evt.target as HTMLElement;

    if (__categoryPopupMenu.contains(target as Node)) {
        return;
    }

    hidePopupMenu();
}

export function hidePopupMenu() {
    __categoryPopupMenu.style.display = 'none';
    document.removeEventListener('click', handleClickOutside);
}

function _setItemActive(item: HTMLElement, id: number) {
    item.style.backgroundColor = choseColorByID(id, 0.2);
}

function _cloneMenuItem(templateItem: HTMLElement, cat: Category, kol: TweetKol): HTMLElement {
    const clone = templateItem.cloneNode(true) as HTMLElement;
    clone.style.display = 'block';
    if (cat.id === kol.catID) {
        _setItemActive(clone, cat.id!);
    }

    clone.dataset.categoryid = '' + cat.id;
    (clone.querySelector(".dot") as HTMLElement).style.backgroundColor = choseColorByID(cat.id!);

    clone.querySelector(".menu-item-category-name")!.textContent = cat.catName;

    return clone;
}

async function changeCategoryOfKol(menuItem: HTMLElement, cat: Category, kol: TweetKol) {
    if (kol.catID === cat.id) {
        return;
    }

    __categoryPopupMenu.querySelectorAll(".menu-item").forEach(itemDiv => itemDiv.classList.remove(".active"));
    _setItemActive(menuItem, cat.id!);

    kol.catID = cat.id;
    await updateKolIdToSw(kol);
    fetchImmediateInNextRound(kol.kolName, kol.kolUserId).then();
}

export async function queryKolDetailByName(kolName: string): Promise<TweetKol | null> {
    const rsp = await sendMsgToService(kolName, MsgType.KolQueryByName);

    if (!rsp) {
        return null;
    }

    return rsp.data as TweetKol;
}


// 假设你已经拿到了 tweetNode，即 <div data-testid="cellInnerDiv"> 这个 DOM 元素
function getKolAvatarLink(tweetNode: HTMLElement): string | null {
    // 1. 找到头像容器
    const avatarContainer = tweetNode.querySelector('div[data-testid="Tweet-User-Avatar"]');
    if (!avatarContainer) return null;

    // 2. 在头像容器里找 img 元素（Twitter 常用 pbs.twimg.com 作为头像域名）
    const avatarImg = avatarContainer.querySelector<HTMLImageElement>('img[src^="https://pbs.twimg.com/"]');
    if (!avatarImg) return null;

    // 3. 读取头像链接
    return avatarImg.getAttribute('src');
}
