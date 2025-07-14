/* ------------------------------------------------------------------
 * core/timeline_manager.ts  ——  只负责数据缓存 + 布局 + 加载更多
 * ------------------------------------------------------------------*/

import {TweetCatCell} from "./tweetcat_cell";          // 你的单行对象
import {EntryObj}     from "./object_tweet";
import {
    getNextTweets,
    initTweetPager,
    resetTweetPager
} from "./tweet_data";

/* 让 UI 代码还能 import { TimelineRow } ... */
export type TimelineRow = TweetCatCell;

/* ----------------------------- 批量高度补偿 ----------------------------- */
let adjustPending = false;
let timelineObserver: ResizeObserver | null = null;

function batchAdjustOffsets(timelineEl: HTMLElement, rows: TweetCatCell[]) {
    if (adjustPending) return;
    adjustPending = true;

    requestAnimationFrame(() => {
        let startIdx = -1;
        let totalDh  = 0;

        const newHeights = rows.map(r => r.node.offsetHeight);

        for (let i = 0; i < rows.length; i++) {
            const dh = newHeights[i] - rows[i].height;
            if (dh !== 0) {
                if (startIdx === -1) startIdx = i;
                rows[i].height = newHeights[i];
                totalDh += dh;
            }
        }

        if (startIdx !== -1 && totalDh !== 0) {
            /* 顺推 offset 并改 transform */
            let offset = rows[startIdx].offset + rows[startIdx].height;
            for (let i = startIdx + 1; i < rows.length; i++) {
                rows[i].offset = offset;
                rows[i].node.style.transform = `translateY(${offset}px)`;
                offset += rows[i].height;
            }
            timelineEl.style.height = `${offset}px`;
        }
        adjustPending = false;
    });
}

export function observeTimelineHeight(
    timelineEl: HTMLElement,
    rows: TweetCatCell[]
) {
    timelineObserver?.disconnect();
    timelineObserver = new ResizeObserver(() => batchAdjustOffsets(timelineEl, rows));
    timelineObserver.observe(timelineEl);
    return timelineObserver;
}

/* --------------------------- 滚动到底部加载更多 --------------------------- */
let windowScrollHandler: ((e: Event) => void) | null = null;
let loadingMore = false;

export function bindWindowScrollLoadMore(rows: TweetCatCell[], tpl: HTMLTemplateElement) {
    if (windowScrollHandler) {
        window.removeEventListener("scroll", windowScrollHandler);
        windowScrollHandler = null;
    }

    let lastScroll = 0;
    windowScrollHandler = () => {
        const now = Date.now();
        if (now - lastScroll < 100) return;   // 100 ms 节流
        lastScroll = now;

        const scrollTop   = window.scrollY || document.documentElement.scrollTop;
        const windowH     = window.innerHeight;
        const docH        = document.documentElement.scrollHeight;

        if (!loadingMore && scrollTop + windowH >= docH - 200) {
            loadingMore = true;
            loadMoreData(rows, tpl).finally(() => (loadingMore = false));
        }
    };
    window.addEventListener("scroll", windowScrollHandler, {passive: true});
}

/* ----------------------------- 重置 / 销毁 ----------------------------- */
export function resetTimeline(area: HTMLElement, rows: TweetCatCell[]) {
    const tl = area.querySelector(".tweetTimeline") as HTMLElement;
    tl.innerHTML = "";
    tl.style.removeProperty("height");

    /* 解绑全局监听 */
    windowScrollHandler && window.removeEventListener("scroll", windowScrollHandler);
    windowScrollHandler = null;
    timelineObserver?.disconnect();
    timelineObserver = null;

    /* 清空行缓存并释放节点 */
    rows.forEach(c => c.unmount());
    rows.length = 0;
    resetTweetPager();
}

/* ---------------------- 首次渲染 + 渲染更多逻辑 ---------------------- */
export async function renderAndLayoutTweets(
    timelineEl: HTMLElement,
    tpl: HTMLTemplateElement,
    rows: TweetCatCell[]
) {
    await initTweetPager();
    const tweets = getNextTweets(5);
    if (tweets.length) await appendTweetsToTimeline(timelineEl, tpl, rows, tweets);
}

export async function appendTweetsToTimeline(
    timelineEl: HTMLElement,
    tpl: HTMLTemplateElement,
    rows: TweetCatCell[],
    tweets: EntryObj[]
) {
    /* 计算起始 offset */
    let offset = rows.length
        ? rows[rows.length - 1].offset + rows[rows.length - 1].height
        : 0;

    for (const tw of tweets) {
        const cell = new TweetCatCell(tw, tpl);
        await cell.mount(timelineEl, offset);
        rows.push(cell);
        offset += cell.height;          // 下一个起点
    }
    timelineEl.style.height = `${offset}px`;
}

async function loadMoreData(rows: TweetCatCell[], tpl: HTMLTemplateElement) {
    const timelineEl = document.querySelector(".tweetTimeline") as HTMLElement;
    if (!timelineEl) return;

    const next = getNextTweets(5);
    if (!next.length) return;

    await appendTweetsToTimeline(timelineEl, tpl, rows, next);
}
