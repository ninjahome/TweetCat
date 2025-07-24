/* ------------------------------------------------------------------
 * 核心 Manager —— 缓存 TweetCatCell + 顺推 offset + 加载更多
 * ------------------------------------------------------------------*/

import {TweetCatCell} from "./tweet_div_cell";
import {
    getNextTweets,
    initTweetPagerCache,
    resetTweetPager
} from "./tweet_pager";

import {VirtualScroller} from "./virtual_scroller";
import {logTweetMgn} from "../debug_flags";
import {TweetResizeObserverManager} from "./tweet_resize_observer";

export interface MountResult {
    needScroll: boolean;
    targetTop?: number;   // needScroll=true 时必填
}

export class TweetManager {
    private resizeLogger: TweetResizeObserverManager;

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
        this.resizeLogger = new TweetResizeObserverManager();
        initTweetPagerCache().then(() => {
            logTweetMgn("------>>> tweet cache init success");
        })
        this.scroller = new VirtualScroller(this);
        this.scroller.initFirstPage().then();
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

        this.lastWindow = undefined;
        this.resizeLogger.disconnect();
    }

    private readonly onCellDh = (cell: TweetCatCell, dh: number) => {
        const idx = this.cells.indexOf(cell);
        if (idx === -1) return;
        const newH = this.heights[idx] + dh;
        this.updateHeightAt(idx, newH);
    };

    public updateHeightAt = (idx: number, newH: number): void => {
        const oldH = this.heights[idx] ?? TweetManager.EST_HEIGHT;
        const delta = newH - oldH;
        if (Math.abs(delta) < 1) return;

        this.heights[idx] = newH;

        let offset = this.offsets[idx];
        for (let i = idx; i < this.cells.length; i++) {
            this.offsets[i] = offset;
            const cell = this.cells[i];
            if (cell?.node?.isConnected) {
                cell.node.style.transform = `translateY(${offset}px)`;
            }
            offset += this.heights[i] ?? TweetManager.EST_HEIGHT;
        }

        this.offsets[this.cells.length] = offset;
        this.listHeight = offset;
        this.timelineEl.style.height = this.listHeight < 20400
            ? `20400px`
            : `${this.listHeight + this.bufferPx}px`;

        // this.timelineEl.style.height = `${this.listHeight + this.bufferPx}px`


        const changedOffset = this.offsets[idx] ?? 0;
        const curTop = window.scrollY;
        const shouldAdjustScroll = curTop > changedOffset;

        if (shouldAdjustScroll && this.scroller) {
            const newTop = curTop + delta;
            this.scroller.scrollToTop(newTop); // ✅ 交由 VirtualScroller 管理滚动状态
            logTweetMgn(`[updateHeightAt] adjusted via VirtualScroller: scrollTop ${curTop} -> ${newTop}`);
        }

        logTweetMgn(`[updateHeightAt] cell[${idx}] height updated: ${oldH} -> ${newH}, delta=${delta}`);
    };

    async mountBatch(viewStart: number, viewportHeight: number, fastMode: boolean = false): Promise<MountResult> {
        if (fastMode) {
            const t0 = performance.now();
            const oldListHeight = this.listHeight;
            const result = await this.fastMountBatch(viewStart, viewportHeight);
            logTweetMgn(`[fastMountBatch] cost=${(performance.now() - t0).toFixed(1)}ms istHeight: ${oldListHeight} -> ${this.listHeight}, cssHeight=${this.timelineEl.style.height}`);
            return result;
        }

        logTweetMgn(`[fastMountBatch] normal logic: viewStart=${viewStart}`);
        return {needScroll: false};
    }

    private lastWindow?: { s: number; e: number };

    private async fastMountBatch(viewStart: number, viewportHeight: number): Promise<MountResult> {
        const estH = TweetManager.EST_HEIGHT;
        const buffer = this.bufferPx;

        const countInView = Math.ceil(viewportHeight / estH);
        const totalRenderCount = countInView + 4;

        let startIdx = Math.max(0, Math.floor(viewStart / estH) - 2);
        let endIndex = startIdx + totalRenderCount;


        const maxEndIndex = this.cells.length + TweetManager.MaxTweetOnce;
        if (endIndex > maxEndIndex) {
            endIndex = maxEndIndex;
            startIdx = Math.max(0, endIndex - totalRenderCount);
        }

        logTweetMgn(`[fastMountBatch] startIdx=${startIdx}, endIndex=${endIndex}, cells.length=${this.cells.length}`); // <-- 这里！

        if (endIndex > this.cells.length) {
            const needCount = endIndex - this.cells.length;
            logTweetMgn(`[fastMountBatch] need to load ${needCount} more tweets`);
            await this.loadAndRenderTweetCell(needCount);
            endIndex = Math.min(endIndex, this.cells.length);
        }

        const sameWindow = this.lastWindow && this.lastWindow.s === startIdx && this.lastWindow.e === endIndex

        logTweetMgn(`[fastMountBatch] window=(${startIdx},${endIndex}), sameWindow=${!!sameWindow}`);

        if (sameWindow) {
            logTweetMgn(`[fastMountBatch] skip same window`);
            return {needScroll: false};
        }
        this.lastWindow = {s: startIdx, e: endIndex};

        logTweetMgn(`[fastMountBatch] rendering cells index: [${startIdx}, ${endIndex})`);
        if (startIdx > 0) {
            logTweetMgn(`[fastMountBatch] skipped cells: [0, ${startIdx})`);
        }

        let offset = this.offsets[startIdx] ?? (startIdx * estH);
        logTweetMgn(`[fastMountBatch] init offset: ${offset} for startIndex=${startIdx}`);

        const firstOffset = this.offsets[startIdx] ?? -1;
        const firstHeight = this.heights[startIdx] ?? -1;
        logTweetMgn(`[fastMountBatch] before mount: startIdx=${startIdx}, offset=${firstOffset}, height=${firstHeight}, current scrollTop=${window.scrollY}`);

        const mountPromises: Promise<HTMLElement>[] = [];
        for (let i = startIdx; i < endIndex; i++) {
            const cell = this.cells[i];
            if (!cell.node?.isConnected) {
                mountPromises.push(cell.mount(this.timelineEl, true).then(() => cell.node));
            } else {
                mountPromises.push(Promise.resolve(cell.node));
            }
        }

        const nodesToStable = await Promise.all(mountPromises);
        await waitStableAll(nodesToStable);

        this.unmountCellsBefore(startIdx);
        logTweetMgn(`[fastMountBatch] after unmount, first mounted cell index: ${startIdx}, offset=${this.offsets[startIdx] ?? 'N/A'}, height=${this.heights[startIdx] ?? 'N/A'}`);
        this.unmountCellsAfter(endIndex);
        logTweetMgn(`[fastMountBatch] after unmountCellsAfter: endIndex=${endIndex}`);

        for (let i = startIdx; i < endIndex; i++) {
            const cell = this.cells[i];
            const realH = cell.node.offsetHeight || estH;
            cell.height = realH;
            this.heights[i] = realH;
            this.offsets[i] = offset;
            cell.node.style.transform = `translateY(${offset}px)`;
            logTweetMgn(`[fastMountBatch] cell[${i}] mounted at offset=${offset}, height=${realH}`);
            offset += realH;

            this.resizeLogger.observe(cell.node, i, this.updateHeightAt);
        }

        this.offsets[endIndex] = offset;
        this.listHeight = Math.max(this.listHeight, offset);
        this.timelineEl.style.height = this.listHeight < 20400
            ? `${20400}px`
            : `${this.listHeight + buffer}px`;

        // this.timelineEl.style.height = `${this.listHeight + this.bufferPx}px`

        logTweetMgn(`[fastMountBatch] completed: listHeight=${this.listHeight}, scrollTop=${window.scrollY}`);

        const mountedCount = endIndex - startIdx;
        const middleIndex = startIdx + Math.floor(mountedCount / 2);
        const bottomOffset = this.offsets[endIndex - 1] ?? this.listHeight;
        const maxScrollTop = this.offsets[middleIndex] || bottomOffset - window.innerHeight;

        const realScrollTop = window.scrollY || document.documentElement.scrollTop;
        const needScroll = realScrollTop > maxScrollTop;
        if (needScroll) {
            logTweetMgn(`[fastMountBatch] need rollback to ${maxScrollTop}, before=${window.scrollY}`);
        } else {
            logTweetMgn(`[fastMountBatch] no rollback, scrollTop=${window.scrollY}, maxScrollTop=${maxScrollTop}`);
        }

        return needScroll
            ? {needScroll: true, targetTop: maxScrollTop}
            : {needScroll: false};

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


    private unmountCellsBefore(startIndex: number) {

        for (let i = 0; i < startIndex; i++) {
            const cell = this.cells[i];
            if (cell?.node?.isConnected) {
                this.resizeLogger.unobserve(cell.node);
                cell.unmount();
                logTweetMgn(`[unmountCellsBefore] unmounted cell[${i}] before startIndex=${startIndex}`);
            }
        }
    }

    private unmountCellsAfter(endIndex: number) {
        for (let i = endIndex; i < this.cells.length; i++) {
            const cell = this.cells[i];
            if (cell && cell.node?.isConnected) {
                this.resizeLogger.unobserve(cell.node);
                cell.unmount();
                logTweetMgn(`[unmountCellsAfter] unmounted cell[${i}] after endIndex=${endIndex}`);
            }
        }
    }
}


async function waitStableAll(nodes: HTMLElement[], tries = 3, interval = 50) {
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
