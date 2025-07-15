/* ------------------------------------------------------------------
 * 核心 Manager —— 缓存 TweetCatCell + 顺推 offset + 加载更多
 * ------------------------------------------------------------------*/

import {TweetCatCell} from "./timeline_tweet_obj";
import {EntryObj} from "./object_tweet";
import {
    getNextTweets,
    initTweetPager,
    resetTweetPager
} from "./timeline_data";

export class TweetManager {
    scroller: VirtualScroller | null = null;

    constructor(
        private readonly timelineEl: HTMLElement,
        private readonly tpl: HTMLTemplateElement
    ) {
    }

    async initFirstPage() {
        this.dispose();
        await initTweetPager();
        const tweets = getNextTweets(5);
        if (tweets.length) await appendTweetsToTimeline(this.timelineEl, this.tpl, tweets);
        this.scroller = new VirtualScroller(this.timelineEl, this.tpl);
    }

    dispose() {
        this.timelineEl.innerHTML = "";
        this.timelineEl.style.removeProperty("height");

        this.scroller?.dispose();
        this.scroller = null;

        cells.forEach(c => c.unmount());
        cells.length = 0;
        listHeight = 0;
        resetTweetPager();
    }
}

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
    setTimelineHeight(timelineEl, listHeight, cells.length);
}


/* ------------ 渲染 / 加载更多 ------------ */
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
    setTimelineHeight(timelineEl, listHeight, cells.length);
}

export async function loadMoreData(tpl: HTMLTemplateElement) {
    const timelineEl = document.querySelector(".tweetTimeline") as HTMLElement;
    if (!timelineEl) return;

    const next = getNextTweets(5);
    if (!next.length) return;

    await appendTweetsToTimeline(timelineEl, tpl, next);
}


export class VirtualScroller {
    private buffer = 600;             // 可视区上下缓冲 px
    private loadingMore = false;

    constructor(
        private readonly timelineEl: HTMLElement,
        private readonly tpl: HTMLTemplateElement
    ) {
        this.onScroll = this.onScroll.bind(this);
        window.addEventListener("scroll", this.onScroll, {passive: true});
        this.onScroll();                // 首帧打印一下
    }

    private onScroll() {
        const scrollTop = window.scrollY || document.documentElement.scrollTop;
        const vh = window.innerHeight;
        const visibleTop = scrollTop - this.buffer;
        const visibleBottom = scrollTop + vh + this.buffer;

        const fromIdx = findFirstOverlap(visibleTop);
        const toIdx = findLastOverlap(visibleBottom);

        console.log("[VS] visibleTop:", visibleTop,
            "visibleBottom:", visibleBottom,
            "⟶ range:", fromIdx, "→", toIdx);

        if (!this.loadingMore && toIdx >= cells.length - 1) {
            this.loadingMore = true;
            loadMoreData(this.tpl).finally(() => (this.loadingMore = false));
        }
    }

    dispose() {
        window.removeEventListener("scroll", this.onScroll);
    }
}


/* ---------- 求可见区索引 ---------- */
function findFirstOverlap(top: number): number {
    let l = 0, r = cells.length - 1, ans = cells.length;
    while (l <= r) {
        const m = (l + r) >> 1;
        if (cells[m].offset + cells[m].height > top) {
            ans = m;
            r = m - 1;
        } else {
            l = m + 1;
        }
    }
    return ans;
}

function findLastOverlap(bottom: number): number {
    let l = 0, r = cells.length - 1, ans = -1;
    while (l <= r) {
        const m = (l + r) >> 1;
        if (cells[m].offset < bottom) {
            ans = m;
            l = m + 1;
        } else {
            r = m - 1;
        }
    }
    return ans;
}

// 在文件顶部或合适的位置，先定义一个常量
const FAKE_TOTAL_COUNT = 100;

/**
 * 根据真实内容高度与已加载条目数，
 * 在真实内容高度与平均高度×FAKE_TOTAL_COUNT 之间取大，
 * 并写入 timelineEl.style.height
 */
export function setTimelineHeight(
    timelineEl: HTMLElement,
    listHeight: number,
    loadedCount: number,
    fakeTotalCount = FAKE_TOTAL_COUNT
) {
    // 如果还没加载或传入值异常，就直接用真实高度
    if (!loadedCount || listHeight <= 0) {
        timelineEl.style.height = `${listHeight}px`;
        return;
    }

    // 计算平均高度 & 伪造总高度
    const avgH = listHeight / loadedCount;
    const fakeTotalH = avgH * fakeTotalCount;

    // 最终高度取两者的最大值
    const finalH = Math.max(listHeight, fakeTotalH);

    timelineEl.style.height = `${finalH}px`;
}
