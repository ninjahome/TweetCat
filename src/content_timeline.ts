import { observeSimple } from "./utils";
import { parseContentHtml } from "./content";
import { renderTweetHTML } from "./tweet_render";
import { hideOriginalTweetArea, showOriginalTweetArea, TimelineRow } from "./timeline_util";
import { getNextTweets, resetTweetPager, initTweetPager } from "./tweet_data";

/**
 * Route used when我们切换到自定义时间线时，写入到 location.hash
 */
const selfDefineUrl = "tweetCatTimeLine";

// -----------------------------
// Height compensation: 批量补偿优化、requestAnimationFrame 防抖
// -----------------------------
let adjustPending = false;
let lastAdjustIdx = -1;
let lastAdjustDh = 0;

function scheduleAdjustOffsets(
    timelineEl: HTMLElement,
    rows: TimelineRow[],
    startIdx: number,
    dh: number
) {
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

function adjustOffsets(
    timelineEl: HTMLElement,
    rows: TimelineRow[],
    startIdx: number,
    dh: number
) {
    if (!dh) return;
    for (let i = startIdx + 1; i < rows.length; i++) {
        rows[i].setTop(rows[i].top + dh);
    }
    const newH = (parseFloat(timelineEl.style.height || "0") + dh).toFixed(3);
    timelineEl.style.height = newH + "px";
}

function observeRowHeight(
    timelineEl: HTMLElement,
    rows: TimelineRow[],
    row: TimelineRow,
    idx: number
) {
    const ro = new ResizeObserver(([e]) => {
        const newH = e.contentRect.height;
        const dh = newH - row.height;
        if (!dh) return;
        row.height = newH;
        scheduleAdjustOffsets(timelineEl, rows, idx, dh);
    });
    ro.observe(row.node);
    row.attachObserver(ro);
}

// -----------------------------
// Window 滚动加载更多
// -----------------------------
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
        if (!loadingMore && scrollTop + windowHeight >= docHeight - 10) {
            loadingMore = true;
            console.log("[LoadMore] 已滚动到页面底部，准备加载更多数据");
            loadMoreData(rows, tpl).then(() => {
                loadingMore = false;
            });
        }
    };
    window.addEventListener("scroll", windowScrollHandler);
}

// -----------------------------
// UI bootstrapping helpers
// -----------------------------
function resetTimeline(area: HTMLElement, rows: TimelineRow[]) {
    const tl = area.querySelector(".tweetTimeline") as HTMLElement;
    rows.forEach(r => r.disconnectObserver());
    tl.innerHTML = "";
    tl.style.removeProperty("height");
    rows.length = 0;
    if (windowScrollHandler) {
        window.removeEventListener("scroll", windowScrollHandler);
        windowScrollHandler = null;
    }
    resetTweetPager();
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
        history.replaceState({ id: 123 }, "", "/#/" + selfDefineUrl);
        const timelineEl = area.querySelector(".tweetTimeline") as HTMLElement;
        resetTimeline(area, rows);
        bindWindowScrollLoadMore(rows, tpl);
        renderAndLayoutTweets(timelineEl, tpl, rows).catch(console.error);
    });
}

// -----------------------------
// UI bootstrapping
// -----------------------------
function setupTweetCatUI(menuList: HTMLElement, tpl: HTMLTemplateElement) {
    // 直接在这里解构 template
    const menuItem = tpl.content.getElementById("tweetCatMenuItem")!.cloneNode(true) as HTMLElement;
    const area = tpl.content.getElementById("tweetCatArea")!.cloneNode(true) as HTMLElement;
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
        () => document.querySelector("header nav[role='navigation']") as HTMLElement,
        (nav) => {
            if (nav.querySelector(".tweetCatMenuItem")) return true;
            parseContentHtml("html/content.html").then((tpl) => setupTweetCatUI(nav, tpl));
            return true;
        }
    );
}

export function switchToTweetCatTimeLine() {
    (document.getElementById("tweetCatMenuItem") as HTMLAnchorElement)?.click();
}

// -----------------------------
// 分层: 数据获取、DOM生成、批量渲染与测量
// -----------------------------
async function renderAndLayoutTweets(
    timelineEl: HTMLElement,
    tpl: HTMLTemplateElement,
    rows: TimelineRow[]
) {
    await initTweetPager();
    const tweets = getNextTweets(5);
    if (tweets.length === 0) return;
    await appendTweetsToTimeline(timelineEl, tpl, rows, tweets);
}

async function waitForStableHeightSafe(node: HTMLElement, maxTries = 5, interval = 40): Promise<void> {
    let tries = 0;
    let lastH = node.offsetHeight;
    while (tries < maxTries) {
        await new Promise((res) => setTimeout(res, interval));
        const newH = node.offsetHeight;
        if (Math.abs(newH - lastH) < 1) return;
        lastH = newH;
        tries++;
    }
}

async function appendTweetsToTimeline(
    timelineEl: HTMLElement,
    tpl: HTMLTemplateElement,
    rows: TimelineRow[],
    tweets: any[]
) {
    // 原 buildTweetNodes 已内联
    const nodes = tweets.map((entry) => renderTweetHTML(entry, tpl));
    const frag = document.createDocumentFragment();
    nodes.forEach(n => frag.appendChild(n));
    timelineEl.appendChild(frag);
    await Promise.all(nodes.map((n) => waitForStableHeightSafe(n)));
    let offset = rows.length === 0 ? 0 : rows[rows.length - 1].top + rows[rows.length - 1].height;
    for (const node_1 of nodes) {
        const h = node_1.offsetHeight;
        const row = new TimelineRow(node_1, h, offset, true);
        Object.assign(node_1.style, {
            position: "absolute",
            left: "0",
            top: offset + "px",
            visibility: "visible",
        });
        rows.push(row);
        observeRowHeight(timelineEl, rows, row, rows.length - 1);
        offset += h;
    }
    timelineEl.style.height = offset + "px";
}

function loadMoreData(rows: TimelineRow[], tpl: HTMLTemplateElement) {
    return new Promise<void>(async (resolve) => {
        const timelineEl = document.querySelector(".tweetTimeline") as HTMLElement;
        const nextTweets = getNextTweets(5);
        if (nextTweets.length === 0 || !timelineEl || !tpl) {
            resolve();
            return;
        }
        await appendTweetsToTimeline(timelineEl, tpl, rows, nextTweets);
        resolve();
    });
}
