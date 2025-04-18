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
                restoreReactSection();
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

let customSection: HTMLElement | null = null;
let reactOriginalSection: HTMLElement | null = null;

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

    // 首次保存原React渲染的section，不再删除或替换
    if (!reactOriginalSection) {
        reactOriginalSection = tweetContentSection;
    }

    // 检查是否已添加自定义section
    if (!customSection) {
        customSection = tweetSectionClone;
        reactOriginalSection.parentNode?.appendChild(customSection);
    }

    setSectionVisibility(customSection, true);
    setSectionVisibility(reactOriginalSection, false);
}

function restoreReactSection() {
    if (reactOriginalSection && customSection) {
        setSectionVisibility(reactOriginalSection, true);
        setSectionVisibility(customSection, false);
    }
}

function setSectionVisibility(section: HTMLElement, visible: boolean) {
    section.style.visibility = visible ? 'visible' : 'hidden';
    section.style.position = visible ? 'relative' : 'absolute';
    section.style.pointerEvents = visible ? '' : 'none';
    section.style.height = visible ? '' : '1px';
    section.style.overflow = visible ? '' : 'hidden';
}
