import {parseNameFromTweetCell, parseContentHtml, isHomePage} from "./content";
import {_curKolFilter, resetCategories} from "./content_filter";
import {queryCategoriesFromBG, queryCategoryById} from "./category";
import {__DBK_AD_Block_Key, Category, choseColorByID, maxMissedTweetOnce, MsgType, TweetKol} from "./consts";
import {isAdTweetNode, sendMsgToService} from "./utils";
import {localGet} from "./local_storage";
import * as async_hooks from "node:async_hooks";

let __menuBtnDiv: HTMLElement;
let __categoryPopupMenu: HTMLElement;
let __blockAdStatus: boolean = false;

export function changeAdsBlockStatus(status: boolean) {
    console.log("------>>> change block ads settings:", status);
    // window.location.reload();

    __blockAdStatus = status;
    if (status) {
        (document.querySelectorAll('div[data-testid="cellInnerDiv" ]') as NodeListOf<HTMLElement>).forEach(elm => {
            if (isAdTweetNode(elm)) {
                elm.style.display = 'none';
            }
        })
    }
}

const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
        if (mutation.addedNodes.length > 0) {
            filterTweets(mutation.addedNodes);
        }
    });
});

export async function initObserver() {
    __blockAdStatus = await localGet(__DBK_AD_Block_Key) as boolean ?? false;

    observer.observe(document.body, {childList: true, subtree: true});

    const contentTemplate = await parseContentHtml('html/content.html');

    __menuBtnDiv = contentTemplate.content.getElementById("filter-menu-on-main") as HTMLElement;
    const popupMenu = contentTemplate.content.getElementById("category-popup-menu") as HTMLElement;
    if (!__menuBtnDiv || !popupMenu) {
        console.warn(`------>>> failed to load filter menu ${__menuBtnDiv} ${__categoryPopupMenu}`);
        return;
    }

    __categoryPopupMenu = popupMenu.cloneNode(true) as HTMLElement;
    document.body.appendChild(__categoryPopupMenu);
}

let missCounter = 0;

function filterTweets(nodes: NodeList) {
    nodes.forEach((divNode) => {

        if (!isTweetDiv(divNode)) {
            // console.log("------>>> is home page:", window.location.href);
            return;
        }
        if (__blockAdStatus && isAdTweetNode(divNode)) {
            // console.log("------->>> need to block Ads");
            console.log("------>>> found ads and block it", divNode.dataset.testid);
            divNode.style.display = "none";
            return;
        }

        if (!isHomePage()) {
            return;
        }
        const user = parseNameFromTweetCell(divNode);
        if (!user) {
            // console.log("------------>>>>tweet user name not found:", divNode)
            return;
        }

        appendCategoryMenuOnTweet(divNode, user).then();

        if (_curKolFilter.size === 0) {
            return;
        }

        if (_curKolFilter.has(user.kolName)) {
            console.log('------>>> hint:', user.displayString());
            missCounter = 0;
            return;
        }

        console.log('------>>> miss:', user.displayString());
        divNode.style.display = "none";
        missCounter++;
        if (missCounter > maxMissedTweetOnce) {
            alert("Too few tweets for this category.");
            resetCategories();
            missCounter = 0;
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
    if (!kol) {
        catBtn.style.display = 'block';
        catName.style.display = 'none';
    } else {
        catBtn.style.display = 'none';
        catName.style.display = 'block';
        const cat = await queryCategoryById(kol.catID!);
        if (!cat) {
            console.log("------>>>category data is null for kol", kol);
            return;
        }
        (clone.querySelector(".dot") as HTMLElement).style.backgroundColor = choseColorByID(kol.catID!);
        catName.querySelector(".menu-item-category-name")!.textContent = cat.catName;
    }
}

async function appendCategoryMenuOnTweet(tweetCellDiv: HTMLElement, rawKol: TweetKol) {

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
            alert("no valid categories");//TODO::
            return;
        }

        let kol = await queryKolDetailByName(rawKol.kolName);
        if (!kol) {
            kol = new TweetKol(rawKol.kolName, rawKol.displayName);
        }

        if (!kol.avatarUrl) {
            kol.avatarUrl = getKolAvatarLink(tweetCellDiv) ?? "";
            // console.log("------>>>tweet cell avatar url link:", kol.avatarUrl);
        }
        showPopupMenu(e, clone, categories, kol, setCatMenu);
    };
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
    removeBtn.onclick = () => {
        sendMsgToService(kol.kolName, MsgType.RemoveKol).then(async () => {
            __categoryPopupMenu.style.display = 'none';
            if (callback) {
                await callback(kol.kolName, buttonElement);
            }
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
    await sendMsgToService(kol, MsgType.UpdateKolCat);
}

export async function queryKolDetailByName(kolName: string): Promise<TweetKol | null> {
    const rsp = await sendMsgToService(kolName, MsgType.QueryKolCat);

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
