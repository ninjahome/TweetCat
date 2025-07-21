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
    private static readonly PAGE_SIZE = 30;
    private static readonly MaxTweetOnce = 30;
    private readonly bufferPx = TweetManager.EST_HEIGHT * 4;

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
            logTweetMgn('------>>> prepare render ' + tweets.length + ' tweets to tweetCat cell')

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


    async mountBatch(viewStart: number, viewportHeight: number, fastMode: boolean = false) {
        logTweetMgn(`批量挂载 start=${viewStart}, height=${viewportHeight} fastMode=${fastMode}`);

        if (this.listHeight <= viewStart) {
            await this.fastMountBatch(viewStart, viewportHeight);
            return
        }
    }

    private async fastMountBatch(viewStart: number, viewportHeight: number) {
        const estH = TweetManager.EST_HEIGHT;
        const buffer = this.bufferPx;

        const countInView = Math.ceil(viewportHeight / estH);
        const totalRenderCount = countInView + 4;

        let startIndex = Math.max(0, Math.floor(viewStart / estH) - 2);
        let endIndex = startIndex + totalRenderCount;

        const maxEndIndex = this.cells.length + TweetManager.MaxTweetOnce;
        if (endIndex > maxEndIndex) {
            endIndex = maxEndIndex;
            startIndex = Math.max(0, endIndex - totalRenderCount);
        }

        logTweetMgn(`[fastMountBatch] viewport=(${viewStart}, ${viewportHeight}), target index range: [${startIndex}, ${endIndex})`);

        if (endIndex > this.cells.length) {
            const needCount = endIndex - this.cells.length;
            logTweetMgn(`[fastMountBatch] need to load ${needCount} more tweets`);
            await this.loadAndRenderTweetCell(needCount);
            endIndex = Math.min(endIndex, this.cells.length);
        }

        logTweetMgn(`[fastMountBatch] rendering cells index: [${startIndex}, ${endIndex})`);
        if (startIndex > 0) {
            logTweetMgn(`[fastMountBatch] skipped cells: [0, ${startIndex})`);
        }

        let offset = startIndex * estH;

        const mountPromises: Promise<HTMLElement>[] = [];
        for (let i = startIndex; i < endIndex; i++) {
            const cell = this.cells[i];
            if (!cell.node?.isConnected) {
                mountPromises.push(cell.mount(this.timelineEl, true).then(() => cell.node));
            } else {
                mountPromises.push(Promise.resolve(cell.node));
            }
        }
        const nodesToStable = await Promise.all(mountPromises);
        await waitStableAll(nodesToStable);

        for (let i = startIndex; i < endIndex; i++) {
            const cell = this.cells[i];
            const realH = cell.node.offsetHeight || estH;
            cell.height = realH;
            this.heights[i] = realH;
            this.offsets[i] = offset;
            cell.node.style.transform = `translateY(${offset}px)`;
            logTweetMgn(`[fastMountBatch] cell[${i}] mounted at offset=${offset}, height=${realH}`);
            offset += realH;
        }

        this.offsets[endIndex] = offset;
        this.listHeight = offset;

        this.timelineEl.style.height = this.listHeight < 20400
            ? `${20400}px`
            : `${this.listHeight + buffer}px`;

        logTweetMgn(`[fastMountBatch] completed: listHeight=${this.listHeight}, scrollTop=${window.scrollY}`);

        const maxScrollTop = this.listHeight - window.innerHeight;
        if (window.scrollY > maxScrollTop) {
            logTweetMgn(`[fastMountBatch] scrollTop=${window.scrollY} 超过 maxScrollTop=${maxScrollTop}, triggering scroll rollback`);
            window.scrollTo(0, maxScrollTop);
        }
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
