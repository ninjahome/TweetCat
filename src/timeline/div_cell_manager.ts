/* ------------------------------------------------------------------
 * 核心 Manager —— 缓存 TweetCatCell + 顺推 offset + 加载更多
 * ------------------------------------------------------------------*/

import {TweetCatCell} from "./tweet_div_cell";
import {EntryObj} from "./tweet_entry";
import {
    getNextTweets,
    initTweetPager,
    resetTweetPager
} from "./tweet_pager";

import {VirtualScroller} from "./virtual_scroller";
import {logDiff, logTweetMgn} from "../debug_flags";

const FAKE_TOTAL_COUNT = 2000;
const PAGE_SIZE = 15; // 或根据视窗计算

// --- 可调参数 -------------------------------------------------------
const EST_INIT = 600;        // 初始估高
const EST_ALPHA = 0.15;      // estHeight 指数平滑权重
const INIT_EXTRA = 5;        // 首屏额外预取（在撑满窗口基础上再多取几条）
// -------------------------------------------------------------------


export class TweetManager {
    scroller: VirtualScroller | null = null;
    private cells: TweetCatCell[] = [];
    private listHeight: number = 0;

    // 预估高度（px），用于尚未测量的推文
    private estHeight: number = EST_INIT;
// 推文总数（可从后端获取或先用 FAKE_TOTAL_COUNT）
    private totalCount: number = FAKE_TOTAL_COUNT;
// 每条推文的真实高度数组，长度 = 已加载推文数
    private heights: number[] = [];
// 前缀和偏移数组，length = heights.length + 1，offsets[0] = 0
    private offsets: number[] = [0];

    constructor(
        private readonly timelineEl: HTMLElement,
        private readonly tpl: HTMLTemplateElement
    ) {
    }

    async initFirstPage() {
        this.dispose();
        await initTweetPager();

        const estHeight = this.estHeight;
        const initCount = Math.ceil(window.innerHeight / estHeight) + INIT_EXTRA; // 额外 buffer
        const tweets = await getNextTweets(initCount);
        logTweetMgn("------>>> tweets length:", tweets.length)
        if (tweets.length) await this.appendTweetsToTimeline(tweets);
        this.scroller = new VirtualScroller(this.timelineEl, this);
    }

    dispose() {
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

        resetTweetPager();
    }

    /* ------------ 渲染 / 加载更多 ------------ */
    async appendTweetsToTimeline(tweets: EntryObj[]) {
        // 1. 把新 tweets 转为 cells，预设高度
        for (const tw of tweets) {
            const cell = new TweetCatCell(tw, this.tpl, this.onCellDh, (idx) => this.offsets[idx]);
            cell.index = this.cells.length;
            this.cells.push(cell);

            // 用 estHeight 作为尚未测量项的占位高度
            this.heights.push(this.estHeight);

            // 计算新前缀和
            const lastOffset = this.offsets[this.offsets.length - 1];
            this.offsets.push(lastOffset + this.estHeight);
            cell.offset = lastOffset;
        }

        // 2. 更新 listHeight（已加载部分的真实或预估总高度）
        this.listHeight = this.offsets[this.offsets.length - 1];

        // 3. 更新容器高度
        this.applyContainerHeight();
    }

    async loadMoreData() {
        const next = await getNextTweets(PAGE_SIZE);
        if (!next.length) return;

        await this.appendTweetsToTimeline(next);
    }

    getCells(): TweetCatCell[] {
        return this.cells;
    }

    public updateHeightAt(idx: number, newH: number): void {
        const oldH = this.heights[idx];
        const dh = newH - oldH;
        const scrollTop = window.scrollY || document.documentElement.scrollTop;

        // 无意义或索引越界时直接返回
        if (idx < 0 || idx >= this.heights.length || dh === 0) return;

        // 1. 打印高度变化的核心信息
        console.debug(`[UH] idx=${idx} dh=${dh} scrollTop=${scrollTop} curFirst=${this.scroller?.getCurFirst()}`);

        // 2. 更新本行高度
        this.heights[idx] = newH;
        const selfCell = this.cells[idx];
        if (selfCell) {
            selfCell.height = newH;
        }

        // 3. 重新计算并同步所有后续 offsets & DOM translateY
        for (let j = idx + 1; j <= this.heights.length; j++) {
            // offsets 长度 = heights.length + 1
            this.offsets[j] = this.offsets[j - 1] + this.heights[j - 1];
            if (j < this.cells.length) {
                const c = this.cells[j];
                c.offset = this.offsets[j];
                if (c.node?.isConnected) {
                    c.node.style.transform = `translateY(${this.offsets[j]}px)`;
                }
            }
        }

        // 4. 更新容器高度
        this.listHeight = this.offsets[this.heights.length];
        this.applyContainerHeight();

        // 5. 更新 estHeight（仍保留）
        this.updateEstHeight(newH);

        // 6. 判断是否需要锚点补偿，并打印相关日志
        const rowBottom = this.offsets[idx] + newH;
        const curFirst = this.scroller!.getCurFirst();
        if (rowBottom <= scrollTop || idx < curFirst) {
            console.info(`[QA] queueAnchor dh=${dh} idx=${idx} curFirst=${curFirst} scrollTop=${scrollTop}`);
            this.scroller!.queueAnchor(dh);
        }
    }

    public getHeights(): number[] {
        return this.heights;
    }

    public getOffsets(): number[] {
        return this.offsets;
    }

    /** 给 TweetCatCell 的 Δh 回调，包装成 updateHeightAt */
    private readonly onCellDh = (cell: TweetCatCell, dh: number) => {
        const idx = this.cells.indexOf(cell);
        if (idx === -1) return;
        const newH = this.heights[idx] + dh;
        this.updateHeightAt(idx, newH);
    };

    /** 根据已加载真实高 + 未加载估高，更新容器高度 */
    private applyContainerHeight(): void {
        const loadedCount = this.heights.length;
        const unknownCount = Math.max(0, this.totalCount - loadedCount);
        const totalH = this.listHeight + unknownCount * this.estHeight;
        this.timelineEl.style.height = `${totalH}px`;
    }

    /** 指数平滑更新 estHeight（用于未加载部分估算） */
    private updateEstHeight(sampleH: number): void {
        this.estHeight = this.estHeight + EST_ALPHA * (sampleH - this.estHeight);
        // estHeight 变了 → 未加载估算变 → 更新容器高度
        this.applyContainerHeight();
    }

    public getEstHeight(): number {
        return this.estHeight;
    }
}
