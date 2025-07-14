import {observeSimple} from "./utils";
import {parseContentHtml} from "./content";
import {
    renderAndLayoutTweets,
    resetTimeline, VirtualScroller
} from "./timeline_manager";

const selfDefineUrl = "tweetCatTimeLine";

/**
 * Route used when我们切换到自定义时间线时，写入到 location.hash
 */
function bindReturnToOriginal(
    menuList: HTMLElement,
    area: HTMLElement,
    originalArea: HTMLElement
) {
    menuList.querySelectorAll("a").forEach((a) => {
        a.addEventListener("click", () => {
            area.style.display = "none";
            showOriginalTweetArea(originalArea);
            resetTimeline(area);
        });
    });
}

function bindTweetCatMenu(
    menuItem: HTMLElement,
    area: HTMLElement,
    originalArea: HTMLElement,
    tpl: HTMLTemplateElement
) {
    menuItem.addEventListener("click", (ev) => {
        ev.preventDefault();
        hideOriginalTweetArea(originalArea);
        area.style.display = "block";
        history.replaceState({id: 123}, "", "/#/" + selfDefineUrl);
        const timelineEl = area.querySelector(".tweetTimeline") as HTMLElement;
        resetTimeline(area);
        renderAndLayoutTweets(timelineEl, tpl).then(()=>{
        }).catch(console.error);
    });
}

function setupTweetCatUI(menuList: HTMLElement, tpl: HTMLTemplateElement) {
    const menuItem = tpl.content.getElementById("tweetCatMenuItem")!.cloneNode(true) as HTMLElement;
    const area = tpl.content.getElementById("tweetCatArea")!.cloneNode(true) as HTMLElement;
    const main = document.querySelector("main[role='main']") as HTMLElement;
    const originalArea = main.firstChild as HTMLElement;
    bindReturnToOriginal(menuList, area, originalArea);
    bindTweetCatMenu(menuItem, area, originalArea, tpl);
    menuList.insertBefore(menuItem, menuList.children[1]);
    main.insertBefore(area, originalArea);
}

export function appendTweetCatMenuItem() {
    observeSimple(
        document.body,
        () => document.querySelector("header nav[role='navigation']") as HTMLElement,
        (nav) => {
            if (nav.querySelector(".tweetCatMenuItem")) return true;
            parseContentHtml("html/content.html").then((tpl) => setupTweetCatUI(nav, tpl));
            return true;
        }
    );
}


/* ------------------------------------------------------------------
 * DOM utils – 隐藏 / 显示原生 TimeLine
 * ------------------------------------------------------------------*/
export function hideOriginalTweetArea(el: HTMLElement) {
    Object.assign(el.style, {
        position: "absolute",
        top: "-9999px",
        left: "-9999px",
        width: "1px",
        height: "1px",
        overflow: "hidden",
        pointerEvents: "none",
        visibility: "hidden",
    } as CSSStyleDeclaration);
}

export function showOriginalTweetArea(el: HTMLElement) {
    Object.assign(el.style, {
        position: "",
        top: "",
        left: "",
        width: "",
        height: "",
        overflow: "",
        pointerEvents: "",
        visibility: "",
    } as CSSStyleDeclaration);
}
