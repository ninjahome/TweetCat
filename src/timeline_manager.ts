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
    // timelineEl.style.height = `${listHeight}px`;
    timelineEl.style.height = `${Math.max(tweetCatTimeLineDefaultHeight, listHeight)}px`;
    console.log("timelineEl.style.height ===========>>>>:", timelineEl.style.height)
}


/* ------------ 渲染 / 加载更多 ------------ */

const tweetCatTimeLineDefaultHeight = 10240;

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
    timelineEl.style.height = `${Math.max(tweetCatTimeLineDefaultHeight, listHeight)}px`;
    console.log("timelineEl.style.height =====2======>>>>:", timelineEl.style.height)
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