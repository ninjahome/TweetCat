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

            // 批量先读取高度，防止多次reflow
            const newHeights = rows.map(r => r.node.offsetHeight);

            for (let i = 0; i < rows.length; i++) {
                const dh = newHeights[i] - rows[i].height;
                if (dh) {
                    if (startIdx === -1) startIdx = i;
                    rows[i].height = newHeights[i];
                    totalDh += dh;
                }
            }

            // 批量更新后续行的位置
            if (startIdx !== -1 && totalDh !== 0) {
                let offset = rows[startIdx].top + rows[startIdx].height;
                for (let i = startIdx + 1; i < rows.length; i++) {
                    rows[i].top = offset;
                    rows[i].node.style.transform = `translateY(${offset}px)`;
                    offset += rows[i].height;
                }
                // 只在高度变化时更新容器高度
                if (timelineEl.style.height !== `${offset}px`) {
                    timelineEl.style.height = `${offset}px`;
                }
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
    // 提前设置 will-change，优化 transform
    nodes.forEach(n => {
        n.style.willChange = "transform";
        n.style.minHeight = "100px";
    });

    const frag = document.createDocumentFragment();
    nodes.forEach(n => frag.appendChild(n));
    timelineEl.appendChild(frag);

    // 统一等待所有节点高度稳定，避免 reflow thrashing
    await Promise.all(nodes.map((n) => waitForStableHeightSafe(n)));

    // 批量读取高度
    const heights = nodes.map(n => n.offsetHeight);

    // 批量计算 offset，批量设置样式
    let offset = rows.length === 0 ? 0 : rows[rows.length - 1].top + rows[rows.length - 1].height;
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const h = heights[i];
        const row = new TimelineRow(node, h, offset);
        Object.assign(node.style, {
            position: "absolute",
            left: "0",
            transform: `translateY(${offset}px)`,
            width: "100%",
            visibility: "visible",
            willChange: "transform"
        });
        rows.push(row);
        offset += h;
    }
    // 只在高度变化时写入
    if (timelineEl.style.height !== `${offset}px`) {
        timelineEl.style.height = `${offset}px`;
    }
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
