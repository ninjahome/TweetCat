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
        /* ---------- Δh 基本信息 ---------- */
        const oldH      = this.heights[idx];
        const dh        = newH - oldH;
        const topBefore = this.offsets[idx];                    // 变动前该行的 top
        const scrollTop = window.scrollY || document.documentElement.scrollTop;

        // 供调试：变动行在视口中的相对位置（补偿前）
        const rowTop    = topBefore;
        const rowBottom = rowTop + newH;
        const vpTop     = scrollTop;

        logDiff(
            `[UH] idx=${idx} dh=${dh} top=${topBefore} ` +
            `scrollTop=${scrollTop} curFirst=${this.scroller?.getCurFirst()}`
        );
        logDiff(
            `[UH?] idx=${idx} rowTop=${rowTop} rowBottom=${rowBottom} vpTop=${vpTop}`
        );

        const len = this.heights.length;
        if (idx < 0 || idx >= len || !dh) return;

        /* ---------- 1. 更新本行高度 ---------- */
        this.heights[idx] = newH;

        /* ---------- 2. 重新计算 idx+1..len-1 的 offsets 并同步 DOM ---------- */
        for (let j = idx + 1; j < len; j++) {
            this.offsets[j] = this.offsets[j - 1] + this.heights[j - 1];

            if (j < this.cells.length) {
                const cell = this.cells[j];
                cell.offset = this.offsets[j];
                const node = cell.node;

                if (node?.isConnected) {
                    const ty = parseInt(node.style.transform.match(/-?\d+/)?.[0] ?? 'NaN');
                    if (ty !== this.offsets[j]) {
                        console.warn('[DESYNC]', j, 'ty=', ty, 'offset=', this.offsets[j]);
                    }
                    node.style.transform = `translateY(${this.offsets[j]}px)`;
                } else {
                    logDiff(`[UH] idx=${idx} -> j=${j} node NOT mounted`);
                }
            }
        }

        /* ---------- 3. 更新末尾 sentinel ---------- */
        this.offsets[len] = this.offsets[len - 1] + this.heights[len - 1];

        /* ---------- 4. 同步 listHeight & 容器高度 ---------- */
        this.listHeight = this.offsets[len];
        this.applyContainerHeight();

        /* ---------- 5. 更新 estHeight（指数平滑） ---------- */
        this.updateEstHeight(newH);

        /* ---------- 6. 如有需要，告知 VirtualScroller 做锚定补偿 ---------- */
        const sc = this.scroller;

        // ① 几何判定：整行在视口上方 → 必须补偿
        if (sc && rowBottom <= vpTop) {
            console.trace('[UH] queueAnchor by geometry', idx);
            sc.queueAnchor(dh);
        }

        // ② 旧的 idx 判定：行号在当前渲染区之前
        if (sc && idx < sc.getCurFirst()) {
            console.trace('[UH] queueAnchor by idx', idx);
            sc.queueAnchor(dh);
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
