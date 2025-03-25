import {parseContentHtml, parseNameFromTweetCell} from "./content";
import {_curKolFilter} from "./content_filter";

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
        if ( !isTweetDiv(divNode)) {
            return;
        }
        const user = parseNameFromTweetCell(divNode);
        if (!user) {
            return;
        }

        if(_curKolFilter.size === 0){
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

async function appendFilterMenuOnKolPopupProfile(kolProfile: HTMLElement) {

    const menuAreaDiv = kolProfile.querySelector(".css-175oi2r.r-1awozwy.r-18u37iz.r-1cmwbt1.r-1wtj0ep") as HTMLElement
    if (!menuAreaDiv) {
        console.log("------>>> no menu area in this tweet cell:", kolProfile);
        return;
    }

    const clone = __menuBtnDiv.cloneNode(true) as HTMLElement;
    menuAreaDiv.insertBefore(clone, menuAreaDiv.firstChild);
    clone.onclick = (e) => {
        showPopupMenu(e, clone);
    };
}

function showPopupMenu(event: MouseEvent, buttonElement: HTMLElement) {
    event.stopPropagation();
    event.preventDefault();

    const rect = buttonElement.getBoundingClientRect();
    __categoryPopupMenu.style.top = `${rect.bottom + window.scrollY}px`;
    __categoryPopupMenu.style.left = `${rect.left + window.scrollX}px`;
    __categoryPopupMenu.style.display = 'block';

    const handleClickOutside = (evt: MouseEvent) => {
        const target = evt.target as HTMLElement;
        if (__categoryPopupMenu.contains(target as Node)) {
            const menuItem = target.closest('li.menu-item') as HTMLElement;
            console.log("------>>> category id=>", menuItem.dataset.categoryid);
        }
        __categoryPopupMenu.style.display = 'none';
        document.removeEventListener('click', handleClickOutside);
    };

    document.addEventListener('click', handleClickOutside);
}