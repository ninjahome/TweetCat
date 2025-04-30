import {observeForElement, observeSimple} from "./utils";
import {parseContentHtml} from "./content";
import {fetchTweets, testTweetApi} from "./content_tweet_api";
import {renderTweetHTML, renderTweetsBatch} from "./tweet_render";

const itemSelClasses = ['r-1kihuf0', 'r-sdzlij', 'r-1p0dtai', 'r-hdaws3', 'r-s8bhmr', 'r-u8s1d', 'r-13qz1uu']
let isAddingTweetCatMenuItem = false;

async function appendTweetCatMenuOnHomeNavi(menuList: HTMLElement) {

    if (!menuList || menuList.children.length < 2) {
        console.warn("------>>> failed to find top menu [for you] [following]")
        return null;
    }

    const oldValue = menuList.querySelector(".tweetCat-present-top");
    if (!!oldValue) {
        console.log("------>>> tweetCat menu already append", menuList);
        return;
    }

    const contentTemplate = await parseContentHtml('html/content.html');
    const clone = contentTemplate.content.getElementById("tweetCat-present-top")!.cloneNode(true) as HTMLElement;

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
    isAddingTweetCatMenuItem = false;
}

async function monitorHomeNavMenu(navDiv: HTMLElement) {
    const menuList = navDiv.querySelector('nav[role="navigation"] div[role="tablist"]') as HTMLElement;
    await appendTweetCatMenuOnHomeNavi(menuList)
    observeSimple(navDiv, (records) => {
        return navDiv.querySelector('nav[role="navigation"] div[role="tablist"]') as HTMLElement;
    }, async (menuList) => {
        await appendTweetCatMenuOnHomeNavi(menuList)
        return true;
    })

    // if (isAddingTweetCatMenuItem) {
    //     console.log("------>>> tweetCat tab menu item is being adding");
    //     return
    // }
    // isAddingTweetCatMenuItem = true;
    // observeForElement(navDiv, 10, () => {
    //     return navDiv.querySelector('nav[role="navigation"] div[role="tablist"]') as HTMLElement;
    // }, async (menuList) => {
    //     // console.log("------>>>----------->>>>menuList", menuList);
    //     await appendTweetCatMenuOnHomeNavi(menuList)
    // }, true);
}

export function monitorHomeNaviDiv() {

    observeSimple(document.body, (records) => {
        return document.querySelector('div[data-testid="primaryColumn"]')?.firstChild?.firstChild as HTMLElement;
    }, async (navDiv) => {
         monitorHomeNavMenu(navDiv).then();
        return true;
    })
    //
    // observeForElement(document.body, 30, () => {
    //     return document.querySelector('div[data-testid="primaryColumn"]')?.firstChild?.firstChild as HTMLElement;
    // }, async (navDiv) => {
    //     // console.log("-------------->>> nav :", navDiv)
    //     monitorHomeNavMenu(navDiv);
    // }, false);
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

async function setupTweetCatSection(tweetSectionClone: HTMLElement) {
    tweetSectionClone.setAttribute('aria-labelledby', 'tweetcat-list');
    tweetSectionClone.setAttribute('role', 'region');

    const tweetContentArea = document.querySelector('div[data-testid="primaryColumn"]') as HTMLElement;
    reactOriginalSection = tweetContentArea.querySelector('section[aria-labelledby^="accessible-list-"]') as HTMLElement;

    if (!reactOriginalSection) {
        console.warn("------>>> failed to find original react section");
        return;
    }

    if (!customSection || !tweetContentArea.contains(customSection)) {
        customSection = tweetSectionClone;

        // 插入自定义section到原section之后
        reactOriginalSection.after(customSection);

        // 为自定义section提供独立滚动容器
        customSection.style.height = '100vh';
        customSection.style.overflowY = 'auto';
        customSection.style.position = 'relative';
        customSection.style.display = 'block';
    }

    // 显示自定义section
    setSectionVisibility(customSection, true);

    // 完全冻结原推特section，防止加载数据
    freezeOriginalSection(reactOriginalSection);
}

function restoreReactSection() {
    const tweetContentArea = document.querySelector('div[data-testid="primaryColumn"]') as HTMLElement;
    const reactSection = tweetContentArea.querySelector('section[aria-labelledby^="accessible-list-"]') as HTMLElement;

    if (reactSection && customSection) {
        setSectionVisibility(reactSection, true);
        setSectionVisibility(customSection, false);

        // 恢复原section正常显示和滚动行为
        unfreezeOriginalSection(reactSection);
    }
}

function setSectionVisibility(section: HTMLElement, visible: boolean) {
    if (visible) {
        section.style.visibility = 'visible';
        section.style.position = 'relative';
        section.style.pointerEvents = '';
        section.style.height = '';
        section.style.overflow = '';
    } else {
        section.style.visibility = 'hidden';
        section.style.position = 'fixed';
        section.style.pointerEvents = 'none';
        section.style.height = '1px';
        section.style.width = '1px';
        section.style.top = '0';
        section.style.left = '0';
        section.style.overflow = 'hidden';
    }
}

function freezeOriginalSection(section: HTMLElement) {
    // 彻底冻结原section：设置fixed，并且高度极小，从全局滚动中移除
    section.style.position = 'fixed';
    section.style.top = '0';
    section.style.left = '0';
    section.style.height = '1px';
    section.style.width = '1px';
    section.style.overflow = 'hidden';
    section.style.pointerEvents = 'none';

    // 阻止所有可能的滚动事件
    section.addEventListener('scroll', preventEvent, {passive: false});
    section.addEventListener('wheel', preventEvent, {passive: false});
}

function unfreezeOriginalSection(section: HTMLElement) {
    // 恢复section正常状态
    section.style.position = '';
    section.style.top = '';
    section.style.left = '';
    section.style.height = '';
    section.style.width = '';
    section.style.overflow = '';
    section.style.pointerEvents = '';

    section.removeEventListener('scroll', preventEvent);
    section.removeEventListener('wheel', preventEvent);
}

function preventEvent(e: Event) {
    e.preventDefault();
    e.stopImmediatePropagation();
}


async function pullTweetCatContent() {
    const contentTemplate = await parseContentHtml('html/content.html');
    const tweetSectionClone = contentTemplate.content.getElementById("tweetCatSection")!.cloneNode(true) as HTMLElement;

    await setupTweetCatSection(tweetSectionClone);

    const dynamicArea = tweetSectionClone.querySelector(".dynamic-height-area") as HTMLDivElement
    dynamicArea.innerHTML = '';
    const validTweets = await fetchTweets('1551261351347109888', 20);
    const fragment = renderTweetsBatch(validTweets.tweets, contentTemplate);
    dynamicArea.append(fragment);

    // const obj = validTweets.tweets[0]
    // console.log("-----------tmp tweet obj =>", obj);
    // const cell = renderTweetHTML(0, obj, contentTemplate);
    //
    //
    // dynamicArea.append(cell);
}

async function loadCachedTweets() {
}

async function pullTweetsFromSrv() {

}