import {observeForElement} from "./utils";
import {parseContentHtml} from "./content";

const itemSelClasses = ['r-1kihuf0', 'r-sdzlij', 'r-1p0dtai', 'r-hdaws3', 'r-s8bhmr', 'r-u8s1d', 'r-13qz1uu']

export async function appendCatPresent() {
    observeForElement(document.body, 3000, () => {
        const navDiv = document.querySelector('nav[aria-live="polite"][role="navigation"]');
        const menuList = navDiv?.querySelector('div[role="tablist"]')
        return menuList as HTMLElement
    }, async (menuList) => {
        if (!menuList || menuList.children.length < 2) {
            console.warn("------>>> failed to find top menu [for you] [following]")
            return;
        }

        const contentTemplate = await parseContentHtml('html/content.html');
        const clone = contentTemplate.content.getElementById("tweetCat-present-top")!.cloneNode(true) as HTMLElement;

        const tweetContentArea = document.querySelector('div[data-testid="primaryColumn"] .css-175oi2r.r-f8sm7e.r-13qz1uu.r-1ye8kvj');

        menuList.querySelectorAll("a").forEach(linkElm => {
            linkElm.addEventListener('click', () => {
                console.log("-------->>> switch back to norma twitter");
                removeSelClass(clone);
                (tweetContentArea?.firstChild as HTMLElement).style.display = 'flex';
                if (!!lastTimeLine) {
                    const currentTweetCatSection = document.querySelector('div[data-testid="primaryColumn"] section') as HTMLElement;
                    currentTweetCatSection.parentNode?.replaceChild(lastTimeLine, currentTweetCatSection);
                    lastTimeLine.style.display = 'flex';
                    lastTimeLine = null;
                }
            })
        });

        if (menuList.children.length === 2) {
            menuList.append(clone)
        } else {
            menuList.insertBefore(clone, menuList.children[2])
        }

        clone.onclick = (e) => {
            e.preventDefault();
            setupTweetCatTabStyle(menuList as HTMLElement, clone);
            pullTweetCatContent();
        }
    }, false);
}

function removeSelClass(item: HTMLElement) {
    const subLineItem = item.querySelector(".css-175oi2r.r-xoduu5") as HTMLElement
    itemSelClasses.forEach(className => {
        subLineItem.classList.remove(className)
    })
    subLineItem.removeAttribute('style');
}

function setupTweetCatTabStyle(menuList: HTMLElement, selectedItem: HTMLElement) {
    console.log("------>>>tweetCat content");
    menuList.querySelectorAll("a").forEach(linkElm => {
        linkElm.setAttribute('aria-selected', 'false');
        linkElm.setAttribute('tabindex', '-1');
        removeSelClass(linkElm);
    })

    selectedItem.setAttribute('aria-selected', 'true');
    selectedItem.setAttribute('tabindex', '0');
    selectedItem.focus();

    const subLineItem = selectedItem.querySelector(".css-175oi2r.r-xoduu5") as HTMLElement
    itemSelClasses.forEach(className => {
        subLineItem.classList.add(className)
    })
    subLineItem.setAttribute('style', 'background-color: rgb(29, 155, 240)');
}

let lastTimeLine: HTMLElement | null = null;

async function pullTweetCatContent() {
    const contentTemplate = await parseContentHtml('html/content.html');
    const tweetSectionClone = contentTemplate.content.getElementById("tweetCatSection")!.cloneNode(true) as HTMLElement;
    tweetSectionClone.setAttribute('aria-labelledby', 'tweetcat-list');
    tweetSectionClone.setAttribute('role', 'region');
    const tweetContentSection = document.querySelector('div[data-testid="primaryColumn"] section') as HTMLElement;
    if (!tweetContentSection) {
        console.warn("------>>> failed to find tweet content area");
        return;
    }

    console.log("------>>> tweet area:", tweetContentSection);
    lastTimeLine = tweetContentSection;
    tweetContentSection.parentNode?.replaceChild(tweetSectionClone, tweetContentSection);
}
