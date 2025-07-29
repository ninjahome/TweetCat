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
import {findCellFromNode} from "./div_node_pool";

export interface MountResult {
    needScroll: boolean;
    targetTop?: number;   // needScroll=true 时必填
}

export class TweetManager {
    private resizeLogger: TweetResizeObserverManager;

    private isRendering = false;
    private scroller: VirtualScroller | null = null;
    private cells: TweetCatCell[] = [];
    public listHeight: number = 0;
    private heights: number[] = [];
    private offsets: number[] = [0];
    public static readonly EST_HEIGHT = 500;
    private static readonly PAGE_SIZE = 30;
    private static readonly MaxTweetOnce = 30;
    public readonly bufferPx = TweetManager.EST_HEIGHT * 4;
    private lastWindow?: { s: number; e: number };
    private static readonly EXTRA_BUFFER_COUNT = 4;
    private static readonly MIN_TWEETS_COUNT = 6;
    private static readonly TWEET_LIME_HEIGHT = 20400;

    constructor(
        public readonly timelineEl: HTMLElement,
        private readonly tpl: HTMLTemplateElement
    ) {
        this.resizeLogger = new TweetResizeObserverManager();
        initTweetPagerCache().then(() => {
            logTweetMgn("------>>> tweet cache init success");
        })
        this.scroller = new VirtualScroller(this);
        this.scroller.initFirstPage().then();
        this.timelineEl.style.height = TweetManager.TWEET_LIME_HEIGHT + `px`;

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
        this.timelineEl.style.height = this.listHeight < TweetManager.TWEET_LIME_HEIGHT
            ? TweetManager.TWEET_LIME_HEIGHT + `px`
            : `${this.listHeight + this.bufferPx}px`;

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
        logTweetMgn(`[mountBatch] batch mount: viewStart=${viewStart}  viewportHeight=${viewportHeight} fastMode=${fastMode}`);

        const t0 = performance.now();
        const oldListHeight = this.listHeight;

        let result = {needScroll: false};
        if (fastMode) result = await this.fastMountBatch(viewStart, viewportHeight);
        // else result = await this.normalMountBatch(viewStart, viewportHeight);

        logTweetMgn(`[mountBatch] cost=${(performance.now() - t0).toFixed(1)}ms `
            + `  height: ${oldListHeight} -> ${this.listHeight}, cssHeight=${this.timelineEl.style.height}`);

        const gap = this.scroller?.bottomPad ? VirtualScroller.EXTRA_GAP : 0;

        const dynamicH = this.listHeight + this.bufferPx + gap;
        const minH = TweetManager.TWEET_LIME_HEIGHT + gap;   // 给固定底线也加相同 gap

        this.timelineEl.style.height = `${Math.max(dynamicH, minH)}px`;

        this.scroller?.ensureBottomPad(this.listHeight, this.bufferPx);

        return result;

    }

    private async fastMountBatch(viewStart: number, viewportHeight: number): Promise<MountResult> {

        let [startIdx, endIndex] = this.estimateWindow(viewStart, viewportHeight);

        logTweetMgn(`[fastMountBatch] startIdx=${startIdx}, endIndex=${endIndex}, cells.length=${this.cells.length}`); // <-- 这里！

        if (endIndex > this.cells.length) {
            const needCount = endIndex - this.cells.length;
            logTweetMgn(`[fastMountBatch] need to load ${needCount} more tweets`);
            await this.loadAndRenderTweetCell(needCount);
            endIndex = Math.min(endIndex, this.cells.length);
        }

        if (this.isSameWindow(startIdx, endIndex)) {
            logTweetMgn(`[fastMountBatch] skip same window window=(${startIdx},${endIndex})`);
            return {needScroll: false};
        }

        this.lastWindow = {s: startIdx, e: endIndex};

        logTweetMgn(`[fastMountBatch] rendering cells index: [${startIdx}, ${endIndex})`);
        if (startIdx > 0) {
            logTweetMgn(`[fastMountBatch] skipped cells: [0, ${startIdx})`);
        }

        const estH = TweetManager.EST_HEIGHT;
        let offset = this.offsets[startIdx] ?? (startIdx * estH);
        logTweetMgn(`[fastMountBatch] init offset: ${offset} for startIndex=${startIdx}`);

        const firstOffset = this.offsets[startIdx] ?? -1;
        const firstHeight = this.heights[startIdx] ?? -1;
        logTweetMgn(`[fastMountBatch] before mount: startIdx=${startIdx}, offset=${firstOffset}, 
        height=${firstHeight}, current scrollTop=${window.scrollY}`);

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
        logTweetMgn(`[fastMountBatch] after unmount, first mounted cell index: ${startIdx}, 
        offset=${this.offsets[startIdx] ?? 'N/A'}, height=${this.heights[startIdx] ?? 'N/A'}`);
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
        this.timelineEl.style.height = this.listHeight < TweetManager.TWEET_LIME_HEIGHT
            ? `${TweetManager.TWEET_LIME_HEIGHT}px`
            : `${this.listHeight + this.bufferPx}px`;

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

    private hasUsableOffset(index: number): boolean {
        return this.offsets[index] !== undefined && this.heights[index] !== undefined;
    }

    private findKnownOffsetAnchor(startIdx: number): number {
        const MAX_LOOKBACK = 4;
        for (let i = startIdx - 1; i >= 0 && i >= startIdx - MAX_LOOKBACK; i--) {
            if (this.hasUsableOffset(i)) return i;
        }
        return -1;
    }

    private findLastKnownOffsetIndex(startIdx: number, endIdx: number): number {
        for (let i = endIdx - 1; i >= startIdx; i--) {
            if (this.hasUsableOffset(i)) return i;
        }
        return -1;
    }

    private resolveMountStartIdx(startIdx: number, endIdx: number): {
        mountStartIdx: number;
        needRelayOut: boolean;
    } {
        if (this.hasUsableOffset(startIdx)) {
            const mountStartIdx = this.findLastKnownOffsetIndex(startIdx, endIdx);
            if (mountStartIdx < 0) throw new Error("Unexpected: known offset at startIdx but none found in range");
            logTweetMgn(`[resolveMountStartIdx] ✅ case 1: startIdx=${startIdx} has offset -> use ${mountStartIdx}`);
            return {mountStartIdx, needRelayOut: false};
        }

        const anchor = this.findKnownOffsetAnchor(startIdx);
        if (anchor >= 0) {
            logTweetMgn(`[resolveMountStartIdx] ✅ case 2: found anchor at ${anchor}, relay out`);
            return {mountStartIdx: anchor, needRelayOut: true};
        }

        const mountStartIdx = this.findLastKnownOffsetIndex(startIdx, endIdx);
        if (mountStartIdx < 0) throw new Error("No known offset found in entire range");
        logTweetMgn(`[resolveMountStartIdx] ✅ case 3: fallback to mountStartIdx=${mountStartIdx}, skip empty region`);
        return {mountStartIdx, needRelayOut: false};
    }


    private async normalMountBatch(viewStart: number, viewportHeight: number): Promise<MountResult> {
        const estH = TweetManager.EST_HEIGHT;
        const derived = this.deriveWindowFromMountedNodes();
        let startIdx: number, endIndex: number;

        if (derived) {
            [startIdx, endIndex] = derived;
            logTweetMgn(`[normalMountBatch] derived window: [${startIdx}, ${endIndex})`);
        } else {
            [startIdx, endIndex] = this.estimateWindow(viewStart, viewportHeight);
            logTweetMgn(`[normalMountBatch] fallback estimate window: [${startIdx}, ${endIndex})`);
        }

        const cells = this.cells;
        const offsets = this.offsets;
        const heights = this.heights;
        if (endIndex > cells.length) {
            const needCount = endIndex - cells.length;
            logTweetMgn(`[normalMountBatch] need to load ${needCount} new tweets`);
            await this.loadAndRenderTweetCell(needCount);
            endIndex = Math.min(endIndex, cells.length);
        }

        const sameWindow = this.isSameWindow(startIdx, endIndex);
        if (sameWindow) {
            logTweetMgn(`[normalMountBatch] skip same window: current=[${startIdx},${endIndex})`
                + ` within lastWindow=[${this.lastWindow!.s},${this.lastWindow!.e})`);
            return {needScroll: false};
        }

        this.lastWindow = {s: startIdx, e: endIndex};
        logTweetMgn(`[normalMountBatch] mounting cells index: [${startIdx}, ${endIndex})`);

        const {mountStartIdx, needRelayOut} = this.resolveMountStartIdx(startIdx, endIndex);
        let offset = offsets[mountStartIdx] ?? startIdx * estH;
        logTweetMgn(`[normalMountBatch]  needRelayOut= [${needRelayOut}], mount start idx=${mountStartIdx}`
            + ` start offset=${offset} (source: ${needRelayOut ? "anchor" : "lastKnownInRange"})`);

        // const mountedNodes: HTMLElement[] = [];
        // for (let i = mountStartIdx; i < endIndex; i++) {
        //     const cell = cells[i];
        //     if (!cell.node?.isConnected) {
        //         logTweetMgn(`[normalMountBatch] cell[${i}] need to mount`);
        //         await cell.mount(this.timelineEl, false);  // 内部包含稳定等待
        //     }
        //     mountedNodes.push(cell.node);
        // }
        // await waitStableAll(mountedNodes);
        // logTweetMgn(`[normalMountBatch]  node number to mount [${mountedNodes.length}] `);

        //
        // // 计算并更新 offset + height + transform
        // let offset = offsets[startIdx] ?? startIdx * estH;
        // for (let i = startIdx; i < endIndex; i++) {
        //     const cell = cells[i];
        //     const realH = cell.node.offsetHeight || estH;
        //     cell.height = realH;
        //     heights[i] = realH;
        //     offsets[i] = offset;
        //     cell.node.style.transform = `translateY(${offset}px)`;
        //     offset += realH;
        //
        //     this.resizeLogger.observe(cell.node, i, this.updateHeightAt);
        //     logTweetMgn(`[normalMountBatch] mounted cell[${i}] at offset=${offset - realH}, height=${realH}`);
        // }
        //
        // offsets[endIndex] = offset;
        //
        // // 卸载窗口外的节点
        // this.unmountCellsBefore(startIdx);
        // this.unmountCellsAfter(endIndex);
        //
        // // 更新容器高度
        // this.listHeight = Math.max(this.listHeight, offset);
        // this.timelineEl.style.height = this.listHeight < 20400
        //     ? `20400px`
        //     : `${this.listHeight + this.bufferPx}px`;
        //
        // logTweetMgn(`[normalMountBatch] done, listHeight=${this.listHeight}, scrollTop=${window.scrollY}`);

        return {needScroll: false};
    }

    private isSameWindow(curStart: number, curEnd: number): boolean {
        if (!this.lastWindow) return false;
        const {s, e} = this.lastWindow;
        return s <= curStart && e >= curEnd;
    }

    private estimateWindow(viewStart: number, viewportHeight: number): [number, number] {
        const estH = TweetManager.EST_HEIGHT;
        const countInView = Math.ceil(viewportHeight / estH);
        const totalRenderCount = countInView + TweetManager.EXTRA_BUFFER_COUNT;

        let startIdx = Math.max(0, Math.floor(viewStart / estH) - Math.floor(TweetManager.EXTRA_BUFFER_COUNT / 2));
        let endIndex = startIdx + totalRenderCount;

        const maxEndIndex = this.cells.length + TweetManager.MaxTweetOnce;
        if (endIndex > maxEndIndex) {
            endIndex = maxEndIndex;
            startIdx = Math.max(0, endIndex - totalRenderCount);
        }

        return [startIdx, endIndex];
    }


    private deriveWindowFromMountedNodes(): [number, number] | null {
        const EXPAND = TweetManager.EXTRA_BUFFER_COUNT / 2;
        const MIN_COUNT = TweetManager.MIN_TWEETS_COUNT

        const cellsInView = Array.from(this.timelineEl.querySelectorAll(".tweet-cardfloat"))
            .filter(el => {
                const rect = el.getBoundingClientRect();
                return rect.bottom > 0 && rect.top < window.innerHeight;
            });

        if (cellsInView.length === 0) return null;

        const visibleEl = cellsInView[Math.floor(cellsInView.length / 2)] as HTMLElement;
        const matchedCell = findCellFromNode(visibleEl);
        if (!matchedCell) return null;

        const centerIdx = matchedCell.index;
        const startIdx = Math.max(0, centerIdx - EXPAND);
        logTweetMgn(`[deriveWindowFromMountedNodes], centerIdx=${centerIdx}, startIdx=${startIdx}`);
        return [startIdx, startIdx + MIN_COUNT];
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
