import {observeSimple} from "./utils";
import {parseContentHtml} from "./content";
import {renderTweetHTML} from "./tweet_render";
import {hideOriginalTweetArea, showOriginalTweetArea, TimelineRow} from "./timeline_util";
import {getNextTweets, resetTweetPager, initTweetPager} from "./tweet_data";
import {EntryObj} from "./object_tweet";

/**
 * Route used when我们切换到自定义时间线时，写入到 location.hash
 */
const selfDefineUrl = "tweetCatTimeLine";

// -----------------------------
// Height compensation: 批量补偿优化、requestAnimationFrame 防抖
// -----------------------------
let adjustPending = false;
let timelineObserver: ResizeObserver | null = null;

function batchAdjustOffsets(timelineEl: HTMLElement, rows: TimelineRow[]) {
    if (!adjustPending) {
        adjustPending = true;
        requestAnimationFrame(() => {
            let totalDh = 0;
            let startIdx = -1;

            // 检查所有行的高度变化
            for (let i = 0; i < rows.length; i++) {
                const newH = rows[i].node.offsetHeight;
                const dh = newH - rows[i].height;
                if (dh) {
                    if (startIdx === -1) startIdx = i;
                    rows[i].height = newH;
                    totalDh += dh;
                }
            }

            // 批量更新后续行的位置
            if (startIdx !== -1 && totalDh !== 0) {
                for (let i = startIdx + 1; i < rows.length; i++) {
                    rows[i].setTop(rows[i].top + totalDh);
                }
                const newH = (parseFloat(timelineEl.style.height || "0") + totalDh).toFixed(3);
                timelineEl.style.height = newH + "px";
            }
            adjustPending = false;
        });
    }
}

function observeTimelineHeight(timelineEl: HTMLElement, rows: TimelineRow[]) {
    if (timelineObserver) {
        timelineObserver.disconnect();
    }
    timelineObserver = new ResizeObserver(() => {
        batchAdjustOffsets(timelineEl, rows);
    });
    timelineObserver.observe(timelineEl);
    return timelineObserver;
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
    let lastScrollTime = 0;
    windowScrollHandler = () => {
        const now = Date.now();
        if (now - lastScrollTime < 100) return; // 限制每100ms触发一次
        lastScrollTime = now;
        const scrollTop = window.scrollY || document.documentElement.scrollTop;
        const windowHeight = window.innerHeight;
        const docHeight = document.documentElement.scrollHeight;
        if (!loadingMore && scrollTop + windowHeight >= docHeight - 200) {
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
    if (timelineObserver) {
        timelineObserver.disconnect();
        timelineObserver = null;
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

async function waitForStableHeightSafe(node: HTMLElement, maxTries = 3, interval = 20): Promise<void> {
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
    tweets: EntryObj[]
) {
    const nodes = tweets.map((entry) => renderTweetHTML(entry, tpl));
    const frag = document.createDocumentFragment();
    nodes.forEach(n => {
        n.style.minHeight = "100px"; // 设置默认最小高度
        frag.appendChild(n);
    });
    timelineEl.appendChild(frag);
    await Promise.all(nodes.map((n) => waitForStableHeightSafe(n)));
    let offset = rows.length === 0 ? 0 : rows[rows.length - 1].top + rows[rows.length - 1].height;
    for (const node_1 of nodes) {
        const h = node_1.offsetHeight;
        const row = new TimelineRow(node_1, h, offset, true);
        Object.assign(node_1.style, {
            position: "absolute",
            left: "0",
            transform: `translateY(${offset}px)`,
            width: "100%",
            visibility: "visible",
        });
        rows.push(row);
        offset += h;
    }
    timelineEl.style.height = offset + "px";
}

async function loadMoreData(rows: TimelineRow[], tpl: HTMLTemplateElement) {
    return new Promise<void>(async (resolve) => {
        const timelineEl = document.querySelector(".tweetTimeline") as HTMLElement;
        if (!timelineEl || !tpl) {
            console.warn("[LoadMore] timelineEl or tpl is missing");
            resolve();
            return;
        }
        const nextTweets = getNextTweets(5);
        if (nextTweets.length === 0) {
            resolve();
            return;
        }
        await appendTweetsToTimeline(timelineEl, tpl, rows, nextTweets);
        resolve();
    });
}