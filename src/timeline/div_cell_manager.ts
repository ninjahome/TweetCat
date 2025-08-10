import {TweetCatCell} from "./tweet_div_cell";
import {
    tweetPager
} from "./tweet_pager";

import {VirtualScroller} from "./virtual_scroller";
import {logTweetMgn} from "../common/debug_flags";
import {TweetResizeObserverManager} from "./tweet_resize_observer";
import {findCellFromNode} from "./div_node_pool";
import {EntryObj} from "./tweet_entry";
import {tweetFetcher} from "./tweet_fetcher";

export interface MountResult {
    needScroll: boolean;
    targetTop?: number;   // needScroll=true 时必填
}


const enum MountDirection {
    None = 0,
    Up = 1,
    Down = 2,
    Both = 3,
    Replace = 4,
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
    public static readonly EST_HEIGHT = 300;
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
        this.timelineEl.style.overscrollBehavior = "none";
        document.documentElement.style.overscrollBehavior = "none";
        this.resizeLogger = new TweetResizeObserverManager();
        tweetPager.init().then(async () => {
            tweetPager.switchCategory(null);
            this.scroller = new VirtualScroller(this);
            await this.scroller!.initFirstPage()
        });
        logTweetMgn("------>>> tweet manager init success");
    }

    public scrollToTop() {
        this.scroller?.scrollToTop({needScroll: true, targetTop: 0})
    }

    async showNewestTweets(tweets: EntryObj[]) {
        tweetPager.showFetchedNewTweets(tweets);
    }

    public async switchCategory(cat: number | null) {
        logTweetMgn("------>>> tweet category switch to:", cat);
        this.resizeLogger = new TweetResizeObserverManager();
        tweetPager.switchCategory(cat);
        this.scroller = new VirtualScroller(this);
        await this.scroller.initFirstPage()
    }

    dispose() {
        logTweetMgn("------>>> tweet manager disposed!");
        this.timelineEl.innerHTML = "";
        this.timelineEl.style.removeProperty("height");
        this.timelineEl.style.removeProperty("min-height");

        this.scroller?.dispose();
        this.scroller = null;

        this.cells.forEach(c => c.unmount());

        this.cells.length = 0;
        this.heights.length = 0;
        this.offsets = [0];
        this.listHeight = 0;
        this.maxCssHeight = 0;

        tweetPager.resetPager();

        tweetFetcher.resetNotifications();

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

        let [startIdx, endIndex] = this.estimateWindow(viewStart, window.innerHeight);

        if (endIndex > this.cells.length) {
            const needCount = endIndex - this.cells.length;
            logTweetMgn(`[fastMountBatch] need to load ${needCount} more tweets`);
            await this.loadAndRenderTweetCell(needCount);
            endIndex = Math.min(endIndex, this.cells.length);
        }

        this.lastWindow = {s: startIdx, e: endIndex};

        const estH = TweetManager.EST_HEIGHT;
        let offset = this.offsets[startIdx] ?? (startIdx * estH);
        logTweetMgn(`[fastMountBatch] prepare mounting range[${startIdx}, ${endIndex}) startOffset=${offset}, current scrollTop=${window.scrollY}`);

        const mountPromises: Promise<HTMLElement>[] = [];
        for (let i = startIdx; i < endIndex; i++) {
            const cell = this.cells[i];
            if (!cell.node?.isConnected) {
                mountPromises.push(cell.mount(this.timelineEl, true).then(() => cell.node));
            }
        }

        const nodesToStable = await Promise.all(mountPromises);
        await waitStableAll(nodesToStable);


        for (let i = startIdx; i < endIndex; i++) {
            const cell = this.cells[i];
            const realH = cell.node.offsetHeight || estH;

            const prevOffset = this.offsets[i];
            const prevHeight = this.heights[i];
            const needsUpdate = offset !== prevOffset || realH !== prevHeight;

            if (needsUpdate) {
                cell.height = realH;
                this.heights[i] = realH;
                this.offsets[i] = offset;
                cell.node.style.transform = `translateY(${offset}px)`;
                logTweetMgn(`[fastMountBatch] cell[${i}] mounted at offset=${offset}, height=${realH}`);
            }

            offset += realH;
            this.resizeLogger.observe(cell.node, i, this.updateHeightAt);
        }

        this.unmountCellsBefore(startIdx);
        this.unmountCellsAfter(endIndex);

        this.finalizeListHeight(offset);


        const mountedCount = endIndex - startIdx;
        const middleIndex = startIdx + Math.floor(mountedCount / 2);
        const bottomOffset = this.offsets[endIndex - 1] ?? this.listHeight;
        const maxScrollTop = this.offsets[middleIndex] || bottomOffset - window.innerHeight;
        const realScrollTop = window.scrollY || document.documentElement.scrollTop;
        const needScroll = realScrollTop > maxScrollTop;
        logTweetMgn(`[fastMountBatch] completed: middleIndex=${middleIndex}, listHeight=${this.listHeight},maxScrollTop=${maxScrollTop} scrollTop=${window.scrollY}`);

        return needScroll
            ? {needScroll: true, targetTop: maxScrollTop}
            : {needScroll: false};
    }

    private async loadAndRenderTweetCell(pageSize: number = TweetManager.MaxTweetOnce) {
        if (this.isRendering) return;
        this.isRendering = true;

        try {
            const tweets = await tweetPager.getNextTweets(pageSize);
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

    private async normalMountBatch(centerIdx: number): Promise<MountResult> {

        const EXPAND = TweetManager.EXTRA_BUFFER_COUNT / 2;
        const MIN_COUNT = TweetManager.MIN_TWEETS_COUNT;
        const startIdx = Math.max(0, centerIdx - EXPAND);
        let endIdx = startIdx + MIN_COUNT;
        const cellLen = this.cells.length;

        logTweetMgn(`[normalMountBatch]preparing anchorIdx=${centerIdx} window Changed:[${this.lastWindow?.s},${this.lastWindow?.e})->=[${startIdx}, ${endIdx}) `);

        if (endIdx > cellLen) {
            const needCount = endIdx - cellLen;
            await this.loadAndRenderTweetCell(needCount);
            endIdx = this.cells.length;
            logTweetMgn(`[normalMountBatch] need to load ${needCount} new tweets preCellLen=${cellLen} newEndIdx=${endIdx}`);
        }

        const direction = this.resolveMountDirection(startIdx, endIdx)
        logTweetMgn(`[resolveMountDirection] new window: [${startIdx}, ${endIdx}) direction=${direction}`);
        if (direction === MountDirection.None || direction === MountDirection.Replace) {
            return {needScroll: false};
        }
        this.lastWindow = {s: startIdx, e: endIdx};

        const anchorOffset = this.offsets[centerIdx];
        let mountStartIdx = startIdx;
        let offset;
        const estH = TweetManager.EST_HEIGHT;
        if (direction === MountDirection.Down) {
            mountStartIdx = centerIdx;
            offset = anchorOffset;
        } else {
            if (this.hasUsableOffset(startIdx)) {
                offset = this.offsets[startIdx];
            } else {
                offset = anchorOffset - (centerIdx - startIdx) * TweetManager.EST_HEIGHT;
                offset = Math.max(offset, 0)
            }
        }

        logTweetMgn(`[normalMountBatch] mountIdx=${mountStartIdx}, endIndex=${endIdx}, anchorOffset=${anchorOffset}  startOffset=${offset}`);

        const mountedNodes: HTMLElement[] = [];
        for (let i = mountStartIdx; i < endIdx; i++) {
            const cell = this.cells[i];
            if (!cell.node?.isConnected) {
                logTweetMgn(`[normalMountBatch] cell[${i}] need to mount`);
                await cell.mount(this.timelineEl, true);
                mountedNodes.push(cell.node);
            }
        }

        if (this.cells[startIdx].node.previousSibling) this.reorderMountedNodes(startIdx, endIdx)

        await waitStableAll(mountedNodes);

        for (let i = mountStartIdx; i < endIdx; i++) {
            const cell = this.cells[i];
            const realH = cell.node.offsetHeight || estH;

            const prevOffset = this.offsets[i];
            const prevHeight = this.heights[i];
            const needsUpdate = offset !== prevOffset || realH !== prevHeight;

            if (needsUpdate) {
                cell.height = realH;
                this.heights[i] = realH;
                this.offsets[i] = offset;
                cell.node.style.transform = `translateY(${offset}px)`;
                logTweetMgn(`[normalMountBatch] cell[${i}] previous={o:${prevOffset},h:${prevHeight}} -> {0:${offset}, h:${realH}}`);
            }

            offset += realH;
            this.resizeLogger.observe(cell.node, i, this.updateHeightAt);
        }


        this.unmountCellsBefore(startIdx);
        this.unmountCellsAfter(endIdx);

        this.finalizeListHeight(offset);

        const anchorDelta = this.offsets[centerIdx] - anchorOffset;
        logTweetMgn(`[normalMountBatch] done, listHeight=${this.listHeight}, scrollTop=${window.scrollY} anchorDelta=${anchorDelta}`);
        const needScroll = Math.abs(anchorDelta) >= 10
        return {needScroll: needScroll, targetTop: window.scrollY + anchorDelta};
    }

    private reorderMountedNodes(startIdx: number, endIndex: number) {
        const fragment = document.createDocumentFragment();
        for (let i = startIdx; i < endIndex; i++) {
            fragment.appendChild(this.cells[i].node); // 已挂载节点会被“移动”
        }
        this.timelineEl.appendChild(fragment);
    }

    private resolveMountDirection(
        startIdx: number,
        endIndex: number,
    ): MountDirection {
        if (!this.lastWindow) return MountDirection.Replace;

        const {s, e} = this.lastWindow;

        if (endIndex <= s || startIdx >= e) {
            return MountDirection.Replace;
        }

        if (startIdx >= s && endIndex <= e) {
            return MountDirection.None;
        }

        if (startIdx < s && endIndex > e) {
            return MountDirection.Both;
        }

        if (startIdx < s) {
            return MountDirection.Up;
        }

        if (endIndex > e) {
            return MountDirection.Down;
        }
        return MountDirection.Replace;
    }


    // private estimateWindow(viewStart: number, viewportHeight: number): [number, number] {
    //     let endIndex = Math.floor((viewStart + viewportHeight) / TweetManager.EST_HEIGHT) + TweetManager.EXTRA_BUFFER_COUNT / 2;
    //     if (endIndex < TweetManager.MIN_TWEETS_COUNT) {
    //         return [0, TweetManager.MIN_TWEETS_COUNT];
    //     }
    //
    //     const maxEndIndex = this.cells.length + TweetManager.MaxTweetOnce;
    //     if (endIndex > maxEndIndex) {
    //         endIndex = maxEndIndex;
    //     }
    //
    //     const startIdx = Math.max(0, endIndex - TweetManager.MIN_TWEETS_COUNT);
    //     return [startIdx, endIndex];
    // }

    private estimateWindow(viewStart: number, viewportHeight: number): [number, number] {
        const estH = TweetManager.EST_HEIGHT;
        const offsets = this.offsets;
        const count = this.cells.length;

        const maxOffset = offsets[count] ?? 0;

        if (viewStart >= maxOffset) {
            // viewStart 超出了已加载推文，无法 anchor，只能 fallback
            let endIndex = Math.floor((viewStart + viewportHeight) / estH) + TweetManager.EXTRA_BUFFER_COUNT / 2;
            if (endIndex < TweetManager.MIN_TWEETS_COUNT) {
                return [0, TweetManager.MIN_TWEETS_COUNT];
            }
            const maxEndIndex = count + TweetManager.MaxTweetOnce;
            endIndex = Math.min(endIndex, maxEndIndex);
            const startIdx = Math.max(0, endIndex - TweetManager.MIN_TWEETS_COUNT);
            logTweetMgn(`[estimateWindow] no anchor found estimate[${startIdx},${endIndex})`);
            return [startIdx, endIndex];
        }

        // viewStart 落在已知 offset 范围内，用二分法查找 anchorIdx
        let low = 0, high = count - 1;
        let anchorIdx = 0;
        while (low <= high) {
            const mid = Math.floor((low + high) / 2);
            const midOffset = offsets[mid] ?? (mid * estH);
            if (midOffset === viewStart) {
                anchorIdx = mid;
                break;
            } else if (midOffset < viewStart) {
                anchorIdx = mid; // 记录最接近但小于 viewStart 的位置
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }

        // 向后扩展 buffer，构建挂载窗口
        const buffer = TweetManager.EXTRA_BUFFER_COUNT / 2;
        let endIndex = Math.min(anchorIdx + buffer, count);
        const startIdx = Math.max(0, endIndex - TweetManager.MIN_TWEETS_COUNT);
        logTweetMgn(`[estimateWindow] found anchor[${anchorIdx}] found range is[${startIdx},${endIndex})`);
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
    }

    private finalizeListHeight(offset: number) {
        this.offsets[this.cells.length] = offset;
        this.listHeight = offset;

        const minRequiredHeight = offset + window.innerHeight + this.bufferPx;
        const safeHeight = Math.max(minRequiredHeight, TweetManager.TWEET_LIME_HEIGHT);

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
