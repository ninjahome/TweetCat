import {observeSimple} from "./utils";
import {parseContentHtml} from "./content";
import {renderTweetHTML} from "./tweet_render";
import {hideOriginalTweetArea, showOriginalTweetArea, TimelineRow, waitForStableHeight} from "./timeline_util";
import { getNextTweets, resetTweetPager, initTweetPager } from "./tweet_data";

/**
 * Route used when我们切换到自定义时间线时，写入到 location.hash
 */
const selfDefineUrl = "tweetCatTimeLine";

/* ------------------------------------------------------------------
 * Debug & helpers
 * ------------------------------------------------------------------*/
const DEBUG = true;
const log = (...args: unknown[]) => DEBUG && console.debug(...args);

// Height compensation: 批量补偿优化、requestAnimationFrame 防抖
let adjustPending = false;
let lastAdjustIdx = -1;
let lastAdjustDh = 0;

function scheduleAdjustOffsets(timelineEl: HTMLElement, rows: TimelineRow[], startIdx: number, dh: number) {
    lastAdjustIdx = startIdx;
    lastAdjustDh = dh;
    if (!adjustPending) {
        adjustPending = true;
        requestAnimationFrame(() => {
            adjustOffsets(timelineEl, rows, lastAdjustIdx, lastAdjustDh);
            adjustPending = false;
        });
    }
}

function adjustOffsets(timelineEl: HTMLElement, rows: TimelineRow[], startIdx: number, dh: number) {
    if (!dh) return;
    for (let i = startIdx + 1; i < rows.length; i++) {
        rows[i].top += dh;
        if (rows[i].attached) {
            rows[i].node.style.top = rows[i].top + "px";
        }
    }
    const newH = (parseFloat(timelineEl.style.height || "0") + dh).toFixed(3);
    timelineEl.style.height = newH + "px";
}

function observeRowHeight(timelineEl: HTMLElement, rows: TimelineRow[], row: TimelineRow, idx: number, label: string) {
    const ro = new ResizeObserver(([e]) => {
        const newH = e.contentRect.height;
        const dh = newH - row.height;
        if (!dh) return;
        log(`[delta] ${label} dh=${dh}`);
        row.height = newH;
        scheduleAdjustOffsets(timelineEl, rows, idx, dh);
    });
    ro.observe(row.node);
    // @ts-ignore 保存以便 reset 时 disconnect
    row.node._ro = ro;
}

/* ------------------------------------------------------------------
 * Window 滚动加载更多（参数传递rows、tpl）
 * ------------------------------------------------------------------*/
let windowScrollHandler: ((ev: Event) => void) | null = null;
let loadingMore = false;

function bindWindowScrollLoadMore(rows: TimelineRow[], tpl: HTMLTemplateElement) {
    if (windowScrollHandler) {
        window.removeEventListener("scroll", windowScrollHandler);
        windowScrollHandler = null;
    }
    windowScrollHandler = () => {
        const scrollTop = window.scrollY || document.documentElement.scrollTop;
        const windowHeight = window.innerHeight;
        const docHeight = document.documentElement.scrollHeight;
        if (
            !loadingMore &&
            scrollTop + windowHeight >= docHeight - 10
        ) {
            loadingMore = true;
            console.log("[LoadMore] 已滚动到页面底部，准备加载更多数据");
            loadMoreData(rows, tpl);
        }
    };
    window.addEventListener("scroll", windowScrollHandler);
}

/* ------------------------------------------------------------------
 * UI bootstrapping helpers
 * ------------------------------------------------------------------*/
function createUIElements(tpl: HTMLTemplateElement) {
    const menuItem = tpl.content.getElementById("tweetCatMenuItem")!
        .cloneNode(true) as HTMLElement;
    const area = tpl.content.getElementById("tweetCatArea")!
        .cloneNode(true) as HTMLElement;
    return {menuItem, area};
}

function resetTimeline(area: HTMLElement, rows: TimelineRow[]) {
    const tl = area.querySelector(".tweetTimeline") as HTMLElement;
    tl.querySelectorAll<HTMLElement>(".tweetNode").forEach((n) => {
        // @ts-ignore
        n._ro?.disconnect();
        // @ts-ignore
        delete n._ro;
    });
    tl.innerHTML = "";
    tl.style.removeProperty("height");
    rows.length = 0;
    // 解绑 window 滚动监听
    if (windowScrollHandler) {
        window.removeEventListener("scroll", windowScrollHandler);
        windowScrollHandler = null;
    }
    resetTweetPager(); // 加载数据游标也要重置
}

function bindReturnToOriginal(
    menuList: HTMLElement,
    area: HTMLElement,
    originalArea: HTMLElement,
    rows: TimelineRow[]
) {
    menuList.querySelectorAll("a").forEach((a) => {
        a.addEventListener("click", () => {
            area.style.display = "none";
            showOriginalTweetArea(originalArea);
            resetTimeline(area, rows);
        });
    });
}

function bindCustomMenu(
    menuItem: HTMLElement,
    area: HTMLElement,
    originalArea: HTMLElement,
    tpl: HTMLTemplateElement,
    rows: TimelineRow[]
) {
    menuItem.addEventListener("click", (ev) => {
        ev.preventDefault();
        hideOriginalTweetArea(originalArea);
        area.style.display = "block";
        history.replaceState({id: 123}, "", "/#/" + selfDefineUrl);

        const timelineEl = area.querySelector(".tweetTimeline") as HTMLElement;
        resetTimeline(area, rows);
        bindWindowScrollLoadMore(rows, tpl); // 传递 rows 和 tpl
        renderAndLayoutTweets(timelineEl, tpl, rows).catch(console.error);
    });
}

/* ------------------------------------------------------------------
 * UI bootstrapping
 * ------------------------------------------------------------------*/
function setupTweetCatUI(
    menuList: HTMLElement,
    tpl: HTMLTemplateElement
) {
    const {menuItem, area} = createUIElements(tpl);
    const main = document.querySelector("main[role='main']") as HTMLElement;
    const originalArea = main.firstChild as HTMLElement;
    const rows: TimelineRow[] = [];

    bindReturnToOriginal(menuList, area, originalArea, rows);
    bindCustomMenu(menuItem, area, originalArea, tpl, rows);

    menuList.insertBefore(menuItem, menuList.children[1]);
    main.insertBefore(area, originalArea);
}

export function appendTweetCatMenuItem() {
    observeSimple(
        document.body,
        () =>
            document.querySelector("header nav[role='navigation']") as HTMLElement,
        (nav) => {
            if (nav.querySelector(".tweetCatMenuItem")) return true;
            parseContentHtml("html/content.html").then((tpl) =>
                setupTweetCatUI(nav, tpl)
            );
            return true;
        }
    );
}

export function switchToTweetCatTimeLine() {
    (
        document.getElementById("tweetCatMenuItem") as HTMLAnchorElement
    )?.click();
}

/* ------------------------------------------------------------------
 * 分层: 数据获取、DOM生成、批量渲染与测量
 * ------------------------------------------------------------------*/

async function renderAndLayoutTweets(
    timelineEl: HTMLElement,
    tpl: HTMLTemplateElement,
    rows: TimelineRow[]
) {
    await initTweetPager(); // 初始化数据，内部只做一次
    const tweets = getNextTweets(5);
    if (tweets.length === 0) return;
    await appendTweetsToTimeline(timelineEl, tpl, rows, tweets);
}

function buildTweetNodes(tweets: any[], tpl: HTMLTemplateElement): HTMLElement[] {
    return tweets.map((entry) => {
        const node = renderTweetHTML(entry, tpl);
        node.classList.add("tweetNode");
        node.setAttribute("data-tweet-id", String(entry.entryId));
        node.style.position = "static";
        node.style.visibility = "hidden";
        return node;
    });
}

function appendTweetsToTimeline(
    timelineEl: HTMLElement,
    tpl: HTMLTemplateElement,
    rows: TimelineRow[],
    tweets: any[]
) {
    const nodes = buildTweetNodes(tweets, tpl);
    nodes.forEach(n => timelineEl.appendChild(n));
    return Promise.all(nodes.map(waitForStableHeight)).then(() => {
        let offset = rows.length === 0 ? 0 : rows[rows.length - 1].top + rows[rows.length - 1].height;
        for (const [idx, node] of nodes.entries()) {
            const h = node.offsetHeight;
            const row = new TimelineRow(node, h, offset, true);
            Object.assign(node.style, {
                position: "absolute",
                left: "0",
                top: offset + "px",
                visibility: "visible",
            });
            rows.push(row);
            observeRowHeight(timelineEl, rows, row, rows.length - 1, `tweet#${node.getAttribute("data-tweet-id")}`);
            offset += h;
        }
        timelineEl.style.height = offset + "px";
    });
}

function loadMoreData(rows: TimelineRow[], tpl: HTMLTemplateElement) {
    return new Promise<void>(async (resolve) => {
        const timelineEl = document.querySelector(".tweetTimeline") as HTMLElement;
        const nextTweets = getNextTweets(5);
        if (nextTweets.length === 0 || !timelineEl || !tpl) {
            loadingMore = false;
            resolve();
            return;
        }
        await appendTweetsToTimeline(timelineEl, tpl, rows, nextTweets);
        loadingMore = false;
        resolve();
    });
}
