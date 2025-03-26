import {curPageIsHome, parseContentHtml, parseNameFromTweetCell} from "./content";
import {_curKolFilter} from "./content_filter";
import {queryCategoriesFromBG} from "./category";
import {Category, itemColorGroup, MsgType, TweetKol} from "./consts";
import {sendMsgToService} from "./utils";

let __menuBtnDiv: HTMLElement;
let __categoryPopupMenu: HTMLElement;

const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
        if (mutation.addedNodes.length > 0) {
            filterTweets(mutation.addedNodes);
        }
    });
});

export async function initObserver() {

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

function filterTweets(nodes: NodeList) {
    nodes.forEach((divNode) => {
        if (!curPageIsHome || !isTweetDiv(divNode)) {
            return;
        }

        const user = parseNameFromTweetCell(divNode);
        if (!user) {
            return;
        }

        appendFilterBtn(divNode, user);

        if (_curKolFilter.size === 0) {
            return;
        }

        if (_curKolFilter.has(user.userName)) {
            console.log('------>>> hint:', user.nameVal());
            return;
        }

        divNode.style.display = "none";
    });
}

function isTweetDiv(node: Node): node is HTMLDivElement {
    return (
        node instanceof HTMLDivElement &&
        node.dataset.testid === 'cellInnerDiv'
    );
}

function appendFilterBtn(tweetCellDiv: HTMLElement, kol: TweetKol) {

    const menuAreaDiv = tweetCellDiv.querySelector(".css-175oi2r.r-1awozwy.r-18u37iz.r-1cmwbt1.r-1wtj0ep") as HTMLElement
    if (!menuAreaDiv) {
        console.log("------>>> no menu area in this tweet cell:", tweetCellDiv);
        return;
    }

    const clone = __menuBtnDiv.cloneNode(true) as HTMLElement;
    menuAreaDiv.insertBefore(clone, menuAreaDiv.firstChild);
    clone.onclick = async (e) => {
        const categories = await queryCategoriesFromBG();
        if (categories.length === 0) {
            alert("no valid categories");//TODO::
            return;
        }
        showPopupMenu(e, clone, categories, kol);
    };
}

function showPopupMenu(event: MouseEvent, buttonElement: HTMLElement, categories: Category[], kol: TweetKol) {
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
        container.append(clone);
    });

    document.addEventListener('click', handleClickOutside);
}

function handleClickOutside(evt: MouseEvent) {
    const target = evt.target as HTMLElement;
    if (__categoryPopupMenu.contains(target as Node)) {
        const menuItem = target.closest('li.menu-item') as HTMLElement;
        console.log("------>>> category id=>", menuItem.dataset.categoryid);
    }
    __categoryPopupMenu.style.display = 'none';
    document.removeEventListener('click', handleClickOutside);
}

function _cloneMenuItem(templateItem: HTMLElement, cat: Category, kol: TweetKol): HTMLElement {
    const clone = templateItem.cloneNode(true) as HTMLElement;
    clone.style.display = 'block';
    if (cat.id === kol.catID) {
        clone.classList.add(".active");
    }

    (clone.querySelector(".dot") as HTMLElement).style.backgroundColor = itemColorGroup[cat.id! % 5];

    clone.querySelector(".menu-item-category-name")!.textContent = cat.catName;
    clone.addEventListener('click', () => {
        changeCategoryOfKol(clone, cat, kol)
    });

    return clone;
}

function changeCategoryOfKol(menuItem: HTMLElement, cat: Category, kol: TweetKol) {
    if (kol.catID === cat.id) {
        return;
    }

    __categoryPopupMenu.querySelectorAll(".menu-item").forEach(itemDiv => itemDiv.classList.remove(".active"));
    menuItem.classList.add(".active");

    kol.catID = cat.id;
    sendMsgToService(kol, MsgType.UpdateKolCat).then();
}