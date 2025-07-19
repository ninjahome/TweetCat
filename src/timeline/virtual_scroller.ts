import {TweetManager} from
        "./div_cell_manager";
import {logAnchor, logDiff} from "../debug_flags";

export class VirtualScroller {
    /* ---------------- 原有字段 ---------------- */
    private buffer = 0;
    private loadingMore = false;

    // 差分挂载状态
    private curFirst = 0;
    private curLast = -1;

    private anchorDh = 0;

    private liteLastTop = 0;
    private liteOnScrollBound?: () => void;

    private rafPending = false;   // 防止重复排队

    private diffRunning = false;

    private static readonly FAST_RATIO = 3;   // ≥3 行即快速
    private static readonly PREFETCH_GAP = 10;

    /* ---------------- 构造 ---------------- */
    constructor(
        private readonly timelineEl: HTMLElement,
        private readonly manager: TweetManager,
    ) {
        this.onResize = this.onResize.bind(this);
        window.addEventListener("resize", this.onResize);

        this.onResize();

        this.enableLiteMode();
    }

    /* ---------------- 原有公共接口（保持不动，必要时仍可用） ---------------- */

    /** Manager 通知：上方高度变动 dh，需要在下一帧 scrollBy 补偿 */
    public queueAnchor(dh: number): void {
        console.trace('[QUEUE-ANCHOR] dh=', dh);
        logAnchor(
            `[VS] Anchor queued dh=${dh} totalDh=${this.anchorDh + dh} scrollTop=${window.scrollY}`
        );
        this.anchorDh += dh;
    }

    public getCurFirst(): number {
        return this.curFirst;
    }

    dispose() {
        this.disableLiteMode();
        window.removeEventListener("resize", this.onResize);
    }

    public async enableLiteMode(): Promise<void> {
        // 1) 挂载首屏
        await this.liteMountInitialBatch();

        // 2) 初始化滚动基准
        this.liteLastTop = window.scrollY || document.documentElement.scrollTop;

        // 3) 轻量滚动监听
        this.liteOnScrollBound = this.liteOnScroll.bind(this);
        window.addEventListener("scroll", this.liteOnScrollBound, {passive: true});
        console.log("[VS-lite] enabled");
    }

    public disableLiteMode(): void {
        if (this.liteOnScrollBound) {
            window.removeEventListener("scroll", this.liteOnScrollBound);
            this.liteOnScrollBound = undefined;
        }
        console.log("[VS-lite] disabled");
    }

    /* ---------------- Lite 模式内部实现 ---------------- */

    private async liteMountInitialBatch(): Promise<void> {
        const cells = this.manager.getCells();
        const offsets = this.manager.getOffsets();
        const heights = this.manager.getHeights();

        if (cells.length === 0) return;

        let acc = 0;
        let last = -1;

        for (let i = 0; i < cells.length; i++) {
            await cells[i].mount(this.timelineEl, offsets[i]);
            const h = cells[i].height;
            if (h !== heights[i]) {
                this.manager.updateHeightAt(i, h);
            }
            acc += h;
            last = i;
        }

        this.curFirst = 0;
        this.curLast = last;
        logDiff(`[VS-lite] initial mounted 0..${last} (px=${acc})`);
    }

    /**
     * 计算本次滚动是否需要 diff，以及是否属于快速滚动。
     * 先判 needUpdate；若需要，再判定 isFastMode（>= FAST_RATIO）
     */
    private checkLiteUpdate(): {
        needUpdate: boolean;
        curTop: number;
        isFastMode: boolean;
    } {
        const curTop = window.scrollY || document.documentElement.scrollTop;
        const delta = Math.abs(curTop - this.liteLastTop);
        const threshold = this.manager.getEstHeight();

        const needUpdate = delta >= threshold;
        const isFastMode = needUpdate && delta >= threshold * VirtualScroller.FAST_RATIO;

        return {needUpdate, curTop, isFastMode};
    }


    private onResize() {
        this.buffer = window.innerHeight * 1.2;
    }

    private async diffMountUnmount(fromIdx: number, toIdx: number): Promise<boolean> {
        logDiff(`[VS] diffMountUnmount IN  curFirst=${this.curFirst} curLast=${this.curLast} -> ${fromIdx}..${toIdx}`);
        if (this.diffRunning) logDiff("[DMM] ⚠️ parallel call detected");
        this.diffRunning = true;

        try {
            const cells   = this.manager.getCells();
            const offsets = this.manager.getOffsets();
            const heights = this.manager.getHeights();

            const lastValid = cells.length - 1;
            if (toIdx   > lastValid) toIdx   = lastValid;
            if (fromIdx < 0)         fromIdx = 0;
            if (toIdx < fromIdx) {
                this.curFirst = fromIdx;
                this.curLast  = toIdx;
                return false;
            }
            if (fromIdx === this.curFirst && toIdx === this.curLast) return false;

            /* ---------- 卸载前缀 ---------- */
            if (fromIdx > this.curFirst) {
                const vpBefore        = window.scrollY || document.documentElement.scrollTop;
                const firstNodeBefore = this.timelineEl.firstElementChild as HTMLElement;
                const topBefore       = firstNodeBefore ? firstNodeBefore.getBoundingClientRect().top : 0;

                for (let i = this.curFirst; i < fromIdx; i++) cells[i].unmount();

                // ⚠️ 不做 queueAnchor —— 让浏览器自己的 scrollTop 变化保持可视锚
                const vpAfter        = window.scrollY || document.documentElement.scrollTop;
                const firstNodeAfter = this.timelineEl.firstElementChild as HTMLElement;
                const topAfter       = firstNodeAfter ? firstNodeAfter.getBoundingClientRect().top : 0;

                logDiff(`[DMM] AFTER   removedPrefix=${fromIdx - this.curFirst}`
                    + `  vp=${vpAfter}  topBefore=${Math.round(topBefore)} topAfter=${Math.round(topAfter)}`);
            }

            /* ---------- 卸载后缀 ---------- */
            if (toIdx < this.curLast) {
                for (let i = toIdx + 1; i <= this.curLast; i++) {
                    cells[i].unmount();
                    if (cells[i].height < 20) console.warn("[VS] suspicious tiny height", i, cells[i]);
                }
            }

            /* ---------- 挂载后缀 ---------- */
            if (toIdx > this.curLast) {
                for (let i = this.curLast + 1; i <= toIdx; i++) {
                    await cells[i].mount(this.timelineEl, offsets[i]);
                    const newH = cells[i].height;
                    if (newH !== heights[i]) this.manager.updateHeightAt(i, newH);
                }
            }

            /* ---------- 挂载前缀 ---------- */
            if (fromIdx < this.curFirst) {
                // 同样不 queueAnchor，这里浏览器会把 scrollTop 自动推下去
                for (let i = fromIdx; i < this.curFirst; i++) {
                    const ref = this.timelineEl.firstChild;
                    await cells[i].mount(this.timelineEl, offsets[i]);
                    if (cells[i].height < 20) console.warn("[VS] suspicious tiny height", i, cells[i]);
                    if (ref) this.timelineEl.insertBefore(cells[i].node, ref);
                    const newH = cells[i].height;
                    if (newH !== heights[i]) this.manager.updateHeightAt(i, newH);
                }
            }

            /* ---------- 更新状态 / 日志 ---------- */
            this.curFirst = fromIdx;
            this.curLast  = toIdx;

            const firstNode = this.timelineEl.firstElementChild as HTMLElement;
            if (firstNode) {
                const top = firstNode.getBoundingClientRect().top;
                logDiff(`[VS] DOM top of first visible = ${Math.round(top)}px`);
            }
            logDiff(`[VS] diffMountUnmount OUT curFirst=${this.curFirst} curLast=${this.curLast}  DOM=${this.timelineEl.childNodes.length}`);

            return this.curLast > lastValid - VirtualScroller.PREFETCH_GAP;
        } finally {
            this.diffRunning = false;
        }
    }

    private computeVisibleRange(offsets: number[]): [number, number] {
        if (offsets.length === 1) return [0, -1];

        const scrollTop = window.scrollY || document.documentElement.scrollTop;
        const top = scrollTop - this.buffer;
        const bottom = scrollTop + window.innerHeight + this.buffer;
        return [
            findFirstOverlap(top, offsets),
            findLastOverlap(bottom, offsets),
        ];
    }

    private liteOnScroll(): void {
        if (this.rafPending) return;          // 已有任务在队列或进行中
        this.rafPending = true;
        requestAnimationFrame(this.liteRafTick);
    }

    private liteRafTick = async () => {
        try {
            if (this.anchorDh !== 0) {
                logAnchor('[VS] apply anchorDh=', this.anchorDh);
                window.scrollBy(0, this.anchorDh);
                this.liteLastTop += this.anchorDh;   // 不让 Δ 影响后续判断
                this.anchorDh = 0;
            }

            const {needUpdate, curTop, isFastMode} = this.checkLiteUpdate();
            if (!needUpdate) return;

            if (isFastMode) await this.diffFastMount();
            else await this.diffNormal();

            this.liteLastTop = curTop;

        } catch (e) {
            console.error("[VS-lite] Raf tick error:", e);
        } finally {
            this.rafPending = false;
        }
    }

    private async diffFastMount() {
        logDiff("[VS-lite] fast mode, defer diff");
    }

    private async diffNormal() {

        const [from, to] = this.computeVisibleRange(this.manager.getOffsets());
        logDiff(`[VS-lite] normal mode newRange ${from}..${to}`);
        const needMoreData = await this.diffMountUnmount(from, to);
        if (!needMoreData || this.loadingMore) return;

        this.loadingMore = true;
        this.manager.loadMoreData().catch(e => console.error('[VS] loadMoreData failed', e)).finally(() => {
            this.loadingMore = false;
        })
    }

    private shouldLoadMoreByIndex(): boolean {
        const cellsLen = this.manager.getCells().length;
        return this.curLast >= cellsLen - VirtualScroller.PREFETCH_GAP
    }
}

export function findLastOverlap(bottom: number, offsets: number[]): number {
    let l = 0, r = offsets.length - 2, ans = -1;
    while (l <= r) {
        const m = (l + r) >> 1;
        if (offsets[m] < bottom) {
            ans = m;
            l = m + 1;
        } else {
            r = m - 1;
        }
    }
    return ans;
}

export function findFirstOverlap(top: number, offsets: number[]): number {
    let l = 0, r = offsets.length - 2, ans = offsets.length - 1;
    while (l <= r) {
        const m = (l + r) >> 1;
        if (offsets[m + 1] > top) {
            ans = m;
            r = m - 1;
        } else {
            l = m + 1;
        }
    }
    return ans;
}
