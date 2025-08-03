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
    private maxCssHeight: number = 0;
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
    private static readonly MAX_LOOK_BACK = 4;

    constructor(
        public readonly timelineEl: HTMLElement,
        private readonly tpl: HTMLTemplateElement
    ) {
        this.timelineEl.style.overscrollBehavior = "none";
        document.documentElement.style.overscrollBehavior = "none";
        this.resizeLogger = new TweetResizeObserverManager();
        initTweetPagerCache().then()
        this.scroller = new VirtualScroller(this);
        this.scroller.initFirstPage().then();
        logTweetMgn("------>>> tweet manager init success");
    }

    public scrollToTop() {
        this.scroller?.scrollToTop({needScroll: true, targetTop: 0})
    }

    async dispose() {
        logTweetMgn("------>>> tweet manager disposed!");
        this.timelineEl.innerHTML = "";
        this.timelineEl.style.removeProperty("height");
        this.timelineEl.style.removeProperty("min-height");

        this.scroller?.dispose();
        this.scroller = null;

        this.cells.forEach(c => c.unmount());

        // 清空数据结构
        this.cells.length = 0;
        this.heights.length = 0;
        this.offsets = [0];
        this.listHeight = 0;
        this.maxCssHeight = 0;

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
        if (Math.abs(delta) < 20) return;

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

        this.finalizeListHeight(offset);

        const changedOffset = this.offsets[idx] ?? 0;
        const curTop = window.scrollY;
        const shouldAdjustScroll = curTop > changedOffset;

        if (shouldAdjustScroll && this.scroller) {
            const newTop = curTop + delta;
            this.scroller.scrollToTop({needScroll: true, targetTop: newTop}); // ✅ 交由 VirtualScroller 管理滚动状态
            logTweetMgn(`[updateHeightAt] adjusted via VirtualScroller: scrollTop ${curTop} -> ${newTop}`);
        }

        logTweetMgn(`[updateHeightAt] cell[${idx}] height updated: ${oldH} -> ${newH}, delta=${delta}`);
    };

    async mountBatch(viewStart: number): Promise<MountResult> {
        logTweetMgn(`[mountBatch] batch mount: viewStart=${viewStart} `);

        const centerIdx = this.deriveWindowFromMountedNodes();
        if (!centerIdx) {
            return await this.fastMountBatch(viewStart);
        }
        return await this.normalMountBatch(centerIdx);
    }

    private async fastMountBatch(viewStart: number): Promise<MountResult> {

        let [startIdx, endIndex] = this.estimateWindow(viewStart,  window.innerHeight);

        if (endIndex > this.cells.length) {
            const needCount = endIndex - this.cells.length;
            logTweetMgn(`[fastMountBatch] need to load ${needCount} more tweets`);
            await this.loadAndRenderTweetCell(needCount);
            endIndex = Math.min(endIndex, this.cells.length);
        }

        this.lastWindow = {s: startIdx, e: endIndex};

        logTweetMgn(`[fastMountBatch] rendering cells index: [${startIdx}, ${endIndex})`);

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

        this.unmountCellsBefore(startIdx);
        this.unmountCellsAfter(endIndex);

        this.finalizeListHeight(offset);

        logTweetMgn(`[fastMountBatch] completed: listHeight=${this.listHeight}, scrollTop=${window.scrollY}`);

        const mountedCount = endIndex - startIdx;
        const middleIndex = startIdx + Math.floor(mountedCount / 2);
        const bottomOffset = this.offsets[endIndex - 1] ?? this.listHeight;
        const maxScrollTop = this.offsets[middleIndex] || bottomOffset - window.innerHeight;

        const realScrollTop = window.scrollY || document.documentElement.scrollTop;
        const needScroll = realScrollTop > maxScrollTop;
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

    private resolveMountStartIdx(startIdx: number): [number, number] {
        if (this.hasUsableOffset(startIdx)) {
            const offset = this.offsets[startIdx]!;
            logTweetMgn(`[ANALYZE] resolveMountStartIdx: idx=${startIdx} ✅ anchor OK offset=${offset}`);
            return [startIdx, offset];
        }

        for (let i = startIdx - 1; i >= 0 && i >= startIdx - TweetManager.MAX_LOOK_BACK; i--) {
            if (this.hasUsableOffset(i)) {
                const offset = this.offsets[i]!;
                logTweetMgn(`[ANALYZE] resolveMountStartIdx: idx=${startIdx} ➡️ fallback→${i} offset=${offset}`);
                return [i, offset];
            }
        }

        logTweetMgn(`[ANALYZE] resolveMountStartIdx: idx=${startIdx} ❌ NO anchor`);
        return [startIdx, -1];
    }

    private async normalMountBatch(centerIdx: number): Promise<MountResult> {

        const EXPAND = TweetManager.EXTRA_BUFFER_COUNT / 2;
        const MIN_COUNT = TweetManager.MIN_TWEETS_COUNT;
        let startIdx = Math.max(0, centerIdx - EXPAND);
        let endIndex = centerIdx + MIN_COUNT;

        if (this.isSameWindow(startIdx, endIndex)) {
            logTweetMgn(`[mountBatch] skip same window window=(${startIdx},${endIndex})`);
            return {needScroll: false};
        }

        logTweetMgn(`[fastMountBatch] startIdx=${startIdx}, endIndex=${endIndex}, cells.length=${this.cells.length}`);

        const estH = TweetManager.EST_HEIGHT;

        const cellLen = this.cells.length;
        if (endIndex > cellLen) {
            const needCount = endIndex - cellLen;
            logTweetMgn(`[normalMountBatch] need to load ${needCount} new tweets`);
            await this.loadAndRenderTweetCell(needCount);
            endIndex = Math.min(endIndex, cellLen);
        }

        const [resolvedStartIdx, knownOffset] = this.resolveMountStartIdx(startIdx);
        startIdx = resolvedStartIdx;

        this.lastWindow = {s: startIdx, e: endIndex};
        logTweetMgn(`[normalMountBatch] mounting cells index: [${startIdx}, ${endIndex})`);

        const mountedNodes: HTMLElement[] = [];
        for (let i = startIdx; i < endIndex; i++) {
            const cell = this.cells[i];
            if (!cell.node?.isConnected) {
                logTweetMgn(`[normalMountBatch] cell[${i}] need to mount`);
                await cell.mount(this.timelineEl, true);
            }
            mountedNodes.push(cell.node);
        }

        if (this.cells[startIdx].node.previousSibling) this.reorderMountedNodes(startIdx, endIndex)

        await waitStableAll(mountedNodes);
        logTweetMgn(`[normalMountBatch]  node number to mount [${mountedNodes.length}] `);

        let offset: number;
        if (knownOffset >= 0) {
            offset = knownOffset;
        } else {
            offset = startIdx * estH;
        }

        logTweetMgn(`[normalMountBatch]   start offset=${offset}`);
        for (let i = startIdx; i < endIndex; i++) {
            const cell = this.cells[i];
            const realH = cell.node.offsetHeight || estH;
            cell.height = realH;
            this.heights[i] = realH;
            this.offsets[i] = offset;
            logTweetMgn(`[normalMountBatch] cell[${i}] prevTransform=${cell.node.style.transform} -> applying offset=${offset} , height=${realH}`);
            cell.node.style.transform = `translateY(${offset}px)`;
            offset += realH;
            this.resizeLogger.observe(cell.node, i, this.updateHeightAt);
        }

        // 卸载窗口外的节点
        this.unmountCellsBefore(startIdx);
        this.unmountCellsAfter(endIndex);

        // 更新容器高度
        this.finalizeListHeight(offset);

        logTweetMgn(`[normalMountBatch] done, listHeight=${this.listHeight}, scrollTop=${window.scrollY}`);

        return {needScroll: false};
    }

    private reorderMountedNodes(startIdx: number, endIndex: number) {
        // 在 normal/fastMountBatch 完成高度计算后，加这一段
        const fragment = document.createDocumentFragment();
        for (let i = startIdx; i < endIndex; i++) {
            fragment.appendChild(this.cells[i].node); // 已挂载节点会被“移动”
        }
        this.timelineEl.appendChild(fragment);
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


    private deriveWindowFromMountedNodes(): number | null {

        const cellsInView = Array.from(this.timelineEl.querySelectorAll(".tweet-cardfloat"))
            .filter(el => {
                const rect = el.getBoundingClientRect();
                return rect.bottom > 0 && rect.top < window.innerHeight;
            });

        if (cellsInView.length === 0) return null;

        const visibleEl = cellsInView[Math.floor(cellsInView.length / 2)] as HTMLElement;
        const matchedCell = findCellFromNode(visibleEl);
        if (!matchedCell) return null;

        return matchedCell.index;

        // const centerIdx = matchedCell.index;
        // const startIdx = Math.max(0, centerIdx - EXPAND);
        // logTweetMgn(`[deriveWindowFromMountedNodes], centerIdx=${centerIdx}, startIdx=${startIdx}`);
        // return [startIdx, startIdx + MIN_COUNT];
    }

    private finalizeListHeight(offset: number) {
        // 1. 记录逻辑高度
        this.offsets[this.cells.length] = offset;
        this.listHeight = offset;

        // 2. 计算本次「安全高度」
        const minRequiredHeight = offset + window.innerHeight + this.bufferPx;
        const safeHeight = Math.max(minRequiredHeight, TweetManager.TWEET_LIME_HEIGHT);

        // 3. 只取历史最大值
        this.maxCssHeight = Math.max(this.maxCssHeight, safeHeight);
        this.timelineEl.style.minHeight = `${this.maxCssHeight}px`;

        logTweetMgn(`[finalizeListHeight] offset=${offset}, applied height=${this.maxCssHeight}`);
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
