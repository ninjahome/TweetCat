/* ------------------------------------------------------------------
 * 核心 Manager —— 缓存 TweetCatCell + 顺推 offset + 加载更多
 * ------------------------------------------------------------------*/

import {TweetCatCell} from "./timeline_tweet";
import {EntryObj} from "./object_tweet";
import {
    getNextTweets,
    initTweetPager,
    resetTweetPager
} from "./timeline_data";

/* 让 UI 仍能 import { TimelineRow } */
export type TimelineRow = TweetCatCell;

/* ------------ 全局缓存 ------------ */
const cells: TweetCatCell[] = [];
let listHeight = 0;

/* ------------ 行高度变动处理 ------------ */
function onCellHeightChange(cell: TweetCatCell, dh: number, timelineEl: HTMLElement) {
    const idx = cells.indexOf(cell);
    if (idx === -1) return;

    /* 顺推后续行 offset */
    for (let i = idx + 1; i < cells.length; i++) {
        cells[i].offset += dh;
        if (cells[i].node.isConnected) {
            cells[i].node.style.transform = `translateY(${cells[i].offset}px)`;
        }
    }
    listHeight += dh;
    timelineEl.style.height = `${listHeight}px`;
}

/* ------------ 渲染 / 加载更多 ------------ */
export async function renderAndLayoutTweets(
    timelineEl: HTMLElement,
    tpl: HTMLTemplateElement
) {
    await initTweetPager();
    const tweets = getNextTweets(5);
    if (tweets.length) await appendTweetsToTimeline(timelineEl, tpl, tweets);
}

export async function appendTweetsToTimeline(
    timelineEl: HTMLElement,
    tpl: HTMLTemplateElement,
    tweets: EntryObj[]
) {
    let offset = listHeight;

    for (const tw of tweets) {
        const cell = new TweetCatCell(tw, tpl, (c, dh) => onCellHeightChange(c, dh, timelineEl));
        await cell.mount(timelineEl, offset);
        cells.push(cell);
        offset += cell.height;
    }

    listHeight = offset;
    timelineEl.style.height = `${listHeight}px`;
}

export async function loadMoreData(tpl: HTMLTemplateElement) {
    const timelineEl = document.querySelector(".tweetTimeline") as HTMLElement;
    if (!timelineEl) return;

    const next = getNextTweets(5);
    if (!next.length) return;

    await appendTweetsToTimeline(timelineEl, tpl, next);
}

/* ------------ 滚动监听（与 UI 保持兼容） ------------ */
let windowScrollHandler: ((e: Event) => void) | null = null;
let loadingMore = false;

export function bindWindowScrollLoadMore(tpl: HTMLTemplateElement) {
    if (windowScrollHandler) {
        window.removeEventListener("scroll", windowScrollHandler);
        windowScrollHandler = null;
    }

    let lastScroll = 0;
    windowScrollHandler = () => {
        const now = Date.now();
        if (now - lastScroll < 100) return;
        lastScroll = now;

        const scrollTop = window.scrollY || document.documentElement.scrollTop;
        const windowH  = window.innerHeight;
        const docH     = document.documentElement.scrollHeight;

        if (!loadingMore && scrollTop + windowH >= docH - 200) {
            loadingMore = true;
            loadMoreData(tpl).finally(() => (loadingMore = false));
        }
    };
    window.addEventListener("scroll", windowScrollHandler, {passive: true});
}

/* ------------ reset / 清理 ------------ */
export function resetTimeline(area: HTMLElement) {
    const tl = area.querySelector(".tweetTimeline") as HTMLElement;
    tl.innerHTML = "";
    tl.style.removeProperty("height");

    /* 解绑滚动 */
    windowScrollHandler && window.removeEventListener("scroll", windowScrollHandler);
    windowScrollHandler = null;

    /* 卸载所有 cell */
    cells.forEach(c => c.unmount());
    cells.length = 0;
    listHeight = 0;

    resetTweetPager();
}
