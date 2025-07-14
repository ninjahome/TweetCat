import {observeSimple} from "./utils";
import {parseContentHtml} from "./content";
import {
    bindWindowScrollLoadMore,
    observeTimelineHeight, renderAndLayoutTweets,
    resetTimeline
} from "./timeline_manager";
import {TweetCatCell} from "./tweetcat_cell";

const selfDefineUrl = "tweetCatTimeLine";

/**
 * Route used when我们切换到自定义时间线时，写入到 location.hash
 */
function bindReturnToOriginal(
    menuList: HTMLElement,
    area: HTMLElement,
    originalArea: HTMLElement,
    rows: TweetCatCell[]
) {
    menuList.querySelectorAll("a").forEach((a) => {
        a.addEventListener("click", () => {
            area.style.display = "none";
            showOriginalTweetArea(originalArea);
            resetTimeline(area, rows);
        });
    });
}

function bindTweetCatMenu(
    menuItem: HTMLElement,
    area: HTMLElement,
    originalArea: HTMLElement,
    tpl: HTMLTemplateElement,
    rows: TweetCatCell[]
) {
    menuItem.addEventListener("click", (ev) => {
        ev.preventDefault();
        hideOriginalTweetArea(originalArea);
        area.style.display = "block";
        history.replaceState({id: 123}, "", "/#/" + selfDefineUrl);
        const timelineEl = area.querySelector(".tweetTimeline") as HTMLElement;
        resetTimeline(area, rows);
        bindWindowScrollLoadMore(rows, tpl);
        renderAndLayoutTweets(timelineEl, tpl, rows).catch(console.error);
        observeTimelineHeight(timelineEl, rows); // 初始化时设置 ResizeObserver
    });
}

function setupTweetCatUI(menuList: HTMLElement, tpl: HTMLTemplateElement) {
    const menuItem = tpl.content.getElementById("tweetCatMenuItem")!.cloneNode(true) as HTMLElement;
    const area = tpl.content.getElementById("tweetCatArea")!.cloneNode(true) as HTMLElement;
    const main = document.querySelector("main[role='main']") as HTMLElement;
    const originalArea = main.firstChild as HTMLElement;
    const rows: TweetCatCell[] = [];
    bindReturnToOriginal(menuList, area, originalArea, rows);
    bindTweetCatMenu(menuItem, area, originalArea, tpl, rows);
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
