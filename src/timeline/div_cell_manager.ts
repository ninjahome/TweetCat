/* ------------------------------------------------------------------
 * 核心 Manager —— 缓存 TweetCatCell + 顺推 offset + 加载更多
 * ------------------------------------------------------------------*/

import {TweetCatCell} from "./tweet_div_cell";
import {EntryObj} from "./tweet_entry";
import {
    getNextTweets,
    initTweetPagerCache,
    resetTweetPager
} from "./tweet_pager";

import {VirtualScroller} from "./virtual_scroller";
import {logTweetMgn} from "../debug_flags";

export class TweetManager {

    private isRendering = false;
    private scroller: VirtualScroller | null = null;
    private cells: TweetCatCell[] = [];
    private listHeight: number = 0;
    private heights: number[] = [];
    private offsets: number[] = [0];
    public static readonly EST_HEIGHT = 500;
    private static readonly PAGE_SIZE = 500;
    private static readonly MaxTweetOnce = 30;
    private readonly bufferPx = TweetManager.EST_HEIGHT * 2;

    constructor(
        private readonly timelineEl: HTMLElement,
        private readonly tpl: HTMLTemplateElement
    ) {
        initTweetPagerCache().then(() => {
            logTweetMgn("------>>> tweet cache init success");
        })
        this.scroller = new VirtualScroller(this);
    }

    public async initFirstPage() {
        await this.scroller?.initFirstPage();
    }

    private async loadAndRenderTweetCell(pageSize: number = TweetManager.PAGE_SIZE) {
        if (this.isRendering) return;

        this.isRendering = true;

        try {
            const tweets = await getNextTweets(pageSize);
            if (!tweets.length) return;//TODO:: no more tweet data!!
            logTweetMgn('------>>> prepare render ' + tweets.length + ' tweets to tweetCat cell')
            for (const tw of tweets) {
                const lastIdx = this.cells.length;
                const cell = new TweetCatCell(tw, this.tpl, this.onCellDh, lastIdx);
                this.cells.push(cell);
            }
        } catch (e) {
            console.warn("------>>> load and render tweetCat cell err:", e)
        } finally {
            this.isRendering = false;
        }
    }

    async dispose() {
        this.timelineEl.innerHTML = "";
        this.timelineEl.style.removeProperty("height");

        this.scroller?.dispose();
        this.scroller = null;

        this.cells.forEach(c => c.unmount());

        // 清空数据结构
        this.cells.length = 0;
        this.heights.length = 0;
        this.offsets = [0];
        this.listHeight = 0;

        await resetTweetPager();

        this.isRendering = false;
    }

    private readonly onCellDh = (cell: TweetCatCell, dh: number) => {
        const idx = this.cells.indexOf(cell);
        if (idx === -1) return;
        const newH = this.heights[idx] + dh;
        this.updateHeightAt(idx, newH);
    };

    public updateHeightAt(idx: number, newH: number): void {
    }


    async mountBatch(viewStart: number, viewEnd: number, fastMode: boolean = false) {
        logTweetMgn(`批量挂载 start=${viewStart}, end=${viewEnd} fastMode=${fastMode}`);

        if (this.listHeight <= viewStart) {
            await this.fastMountBatch(viewStart, viewEnd);
            return
        }
    }

    private async fastMountBatch(viewStart: number, viewEnd: number) {
        const buffer = this.bufferPx;
        const estH = TweetManager.EST_HEIGHT;

        const missingHeight = viewEnd + 2 * buffer - this.listHeight;
        if (missingHeight <= 0) return;

        const missingCount = Math.min(Math.ceil(missingHeight / estH), TweetManager.MaxTweetOnce);
        await this.loadAndRenderTweetCell(missingCount);

        const startIdx = Math.max(0, Math.floor((viewStart - buffer) / estH));
        const endIdx = this.cells.length

        const mountPromises: Promise<HTMLElement>[] = [];
        for (let i = startIdx; i < endIdx; i++) {
            const cell = this.cells[i];
            if (cell && cell.node?.isConnected) {
                mountPromises.push(Promise.resolve(cell.node));
            } else if (cell) {
                mountPromises.push(cell.mount(this.timelineEl, true).then(() => cell.node));
            }
        }
        const nodesToStable = await Promise.all(mountPromises);
        await waitStableAll(nodesToStable);


        let offset = Math.max(Math.floor(viewStart - buffer), 0);
        for (let i = startIdx; i < endIdx; i++) {
            const cell = this.cells[i];
            const realH = cell.node.offsetHeight;
            cell.height = realH;
            this.heights[i] = realH;
            this.offsets[i] = offset;
            cell.node.style.transform = `translateY(${offset}px)`;
            offset += realH;
        }

        this.offsets[endIdx] = offset;
        this.listHeight = offset;
        this.timelineEl.style.height = `${Math.max(this.listHeight, 20400)}px`;
    }
}


async function waitStableAll(nodes: HTMLElement[], tries = 3, interval = 20) {
    if (nodes.length === 0) return;
    let lastHeights = nodes.map(node => node.offsetHeight);
    while (tries-- > 0) {
        await new Promise(r => setTimeout(r, interval));
        const curHeights = nodes.map(node => node.offsetHeight);
        let stable = true;
        for (let i = 0; i < nodes.length; i++) {
            if (Math.abs(curHeights[i] - lastHeights[i]) >= 1) {
                stable = false;
                break;
            }
        }
        if (stable) break;
        lastHeights = curHeights;
    }
}
