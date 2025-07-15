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

import {VirtualScroller} from "./timeline_virtualscroller";

const FAKE_TOTAL_COUNT = 100;

export class TweetManager {
    scroller: VirtualScroller | null = null;
    private cells: TweetCatCell[] = [];
    private listHeight: number = 0;

    constructor(
        private readonly timelineEl: HTMLElement,
        private readonly tpl: HTMLTemplateElement
    ) {
    }

    async initFirstPage() {
        this.dispose();
        await initTweetPager();
        const tweets = getNextTweets(5);
        if (tweets.length) await this.appendTweetsToTimeline(this.timelineEl, this.tpl, tweets);
        this.scroller = new VirtualScroller(this.timelineEl, this.tpl, this);
    }

    dispose() {
        this.timelineEl.innerHTML = "";
        this.timelineEl.style.removeProperty("height");

        this.scroller?.dispose();
        this.scroller = null;

        this.cells.forEach(c => c.unmount());
        this.cells.length = 0;
        this.listHeight = 0;
        resetTweetPager();
    }

    onCellHeightChange(cell: TweetCatCell, dh: number, timelineEl: HTMLElement) {
        const idx = this.cells.indexOf(cell);
        if (idx === -1) return;

        /* 顺推后续行 offset */
        for (let i = idx + 1; i < this.cells.length; i++) {
            this.cells[i].offset += dh;
            if (this.cells[i].node.isConnected) {
                this.cells[i].node.style.transform = `translateY(${this.cells[i].offset}px)`;
            }
        }
        this.listHeight += dh;
        this.setTimelineHeight(timelineEl, this.listHeight, this.cells.length);
    }

    /* ------------ 渲染 / 加载更多 ------------ */
    async appendTweetsToTimeline(
        timelineEl: HTMLElement,
        tpl: HTMLTemplateElement,
        tweets: EntryObj[]
    ) {
        let offset = this.listHeight;

        for (const tw of tweets) {
            const cell = new TweetCatCell(tw, tpl, (c, dh) => this.onCellHeightChange(c, dh, timelineEl));
            await cell.mount(timelineEl, offset);
            this.cells.push(cell);
            offset += cell.height;
        }
        this.listHeight = offset;
        this.setTimelineHeight(timelineEl, this.listHeight, this.cells.length);
    }

    async loadMoreData(tpl: HTMLTemplateElement) {
        const timelineEl = document.querySelector(".tweetTimeline") as HTMLElement;
        if (!timelineEl) return;

        const next = getNextTweets(5);
        if (!next.length) return;

        await this.appendTweetsToTimeline(timelineEl, tpl, next);
    }

    setTimelineHeight(
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

    getCells(): TweetCatCell[] {
        return this.cells;
    }
}

export class NodePool {
    private pool: Map<string, HTMLElement> = new Map();

    constructor(private readonly maxSize: number = 1000) {
    }

    acquire(id: string): HTMLElement | undefined {
        const node = this.pool.get(id);
        if (node) {
            this.pool.delete(id);
            console.log(`[NodePool] Reuse node for id=${id}`);
        }
        console.log(`[NodePool] acquire id=${id} => ${!!node ? "HIT" : "MISS"}`);
        return node;
    }

    release(id: string, node: HTMLElement) {
        if (this.pool.has(id)) return;  // 防止重复加入

        if (this.pool.size >= this.maxSize) {
            // 丢弃最早的一个
            const oldestId = this.pool.keys().next().value as string;
            this.pool.delete(oldestId);
            console.log(`[NodePool] Discard oldest node id=${oldestId}`);
        }

        this.pool.set(id, node);
        console.log(`[NodePool] Released node id=${id}, current size: ${this.pool.size}`);
    }

    size() {
        return this.pool.size;
    }

    clear() {
        this.pool.clear();
        console.log(`[NodePool] Cleared`);
    }
}


export const globalNodePool = new NodePool();
