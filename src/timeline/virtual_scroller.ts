import {TweetManager} from "./div_cell_manager";

export class VirtualScroller {
    private buffer = 0;
    private loadingMore = false;
    private scrollPending = false;

    // 差分挂载状态
    private curFirst = 0;
    private curLast = -1;

    private scrollEvents = 0;
    private rafUpdates = 0;
    private lastScrollTop = 0;

    private diffRunning = false;
    private pendingRange: [number, number] | null = null;

    /** 加载节流 */
    private lastLoadTs = 0;
    private minLoadInterval = 350; // ms; 可按需要调
    /** 基于像素的触底预取（比 index 更稳，配合 atTail） */
    private prefetchPxFactor = 2; // 预取 2 屏
    /** 滚动锚定补偿累计（上方高度变化时由 Manager.queueAnchor 调用） */
    private anchorDh = 0;

    constructor(
        private readonly timelineEl: HTMLElement,
        private readonly manager: TweetManager,
    ) {
        this.onScroll = this.onScroll.bind(this);
        this.rafLoop = this.rafLoop.bind(this);

        window.addEventListener("scroll", this.onScroll, {passive: true});
        this.onResize = this.onResize.bind(this);
        window.addEventListener("resize", this.onResize);
        this.updateBuffer();
        this.rafLoop();
    }

    /** Manager 通知：上方高度变动 dh，需要在下一帧 scrollBy 补偿 */
    public queueAnchor(dh: number): void {
        this.anchorDh += dh;
        // 确保 rAF 下一帧会重算可视区并应用补偿
        this.scrollPending = true;
    }

    /** 提供给 Manager：当前可视首 index */
    public getCurFirst(): number {
        return this.curFirst;
    }

    /** 强制刷新，可用于首次渲染或手动触发更新视图 */
    public refresh(): void {
        this.scrollPending = true;
    }

    private onResize() {
        this.updateBuffer();
    }

    private updateBuffer() {
        this.buffer = window.innerHeight * 1.2;
        // console.log(`[VS] Buffer updated: ${this.buffer}px`);
    }

    private onScroll() {
        this.scrollPending = true;
        this.scrollEvents++;
    }

    dispose() {
        window.removeEventListener("scroll", this.onScroll);
        window.removeEventListener("resize", this.onResize);
    }

    private rafLoop(): void {
        requestAnimationFrame(() => {
            const curScrollTop = window.scrollY || document.documentElement.scrollTop;

            if (this.scrollPending || curScrollTop !== this.lastScrollTop) {
                this.scrollPending = false;
                this.lastScrollTop = curScrollTop;
                this.rafUpdates++;

                const offsets = this.manager.getOffsets();
                const [fromIdx, toIdx] = this.computeVisibleRange(offsets);

                this.requestDiff(fromIdx, toIdx);
            }


            // ---- 锚定补偿（上方高度变化）----
            if (this.anchorDh !== 0) {
                window.scrollBy(0, this.anchorDh);
                this.anchorDh = 0;
                // 标记需要重新计算一次（scrollTop改变）
                this.scrollPending = true;
            }

            // ---- load check ----
            const offsets2 = this.manager.getOffsets();
            const [_chkFrom, chkTo] = this.computeVisibleRange(offsets2);

            const cellsLen = this.manager.getCells().length;
            const totalCnt = this.manager.getTotalCount();
            const atTail = chkTo >= cellsLen - 1 && cellsLen < totalCnt;

            // 像素基准触底（更容错）：当滚动下沿 + 预取X屏 超过已加载高度时也拉
            const vh = window.innerHeight;
            const bottomPx = curScrollTop + vh;
            const loadedPx = offsets2[offsets2.length - 1] ?? 0;
            // const pixelNeed = bottomPx + vh * this.prefetchPxFactor >= loadedPx;
            const pixelNeed = bottomPx + vh * this.prefetchPxFactor >= loadedPx && cellsLen < totalCnt;

            // 列表空（未加载）兜底
            const listEmpty = offsets2.length === 1 && cellsLen < totalCnt;

            // 节流：最短间隔
            const now = performance.now();
            const allowedByTime = now - this.lastLoadTs > this.minLoadInterval;

            if (!this.loadingMore && allowedByTime && (atTail || listEmpty || pixelNeed)) {
                this.loadingMore = true;
                this.lastLoadTs = now;
                console.log(
                    `[VS] Trigger loadMoreData (chkTo=${chkTo}, cells=${cellsLen}, pixelNeed=${pixelNeed})`
                );
                this.manager
                    .loadMoreData()
                    .catch(e => console.error('[VS] loadMoreData failed', e))
                    .finally(() => {
                        this.loadingMore = false;
                    });
            }

            this.rafLoop();
        });
    }

    private async diffMountUnmount(fromIdx: number, toIdx: number) {

        const cells = this.manager.getCells();
        const offsets = this.manager.getOffsets();
        const heights = this.manager.getHeights();

        const lastValid = cells.length - 1;
        if (toIdx > lastValid) toIdx = lastValid;
        if (fromIdx < 0) fromIdx = 0;

        if (toIdx < fromIdx) {
            // 空范围
            this.curFirst = fromIdx;
            this.curLast = toIdx;
            return;
        }

        if (fromIdx === this.curFirst && toIdx === this.curLast) return;   // ← 新增

        // 卸载前缀
        if (fromIdx > this.curFirst) {
            for (let i = this.curFirst; i < fromIdx; i++) {
                cells[i].unmount();
            }
        }
        // 卸载后缀
        if (toIdx < this.curLast) {
            for (let i = toIdx + 1; i <= this.curLast; i++) {
                cells[i].unmount();
                if (cells[i].height < 20) {
                    console.warn('[VS] suspicious tiny height', i, cells[i].height, cells[i]);
                }
            }
        }

        // 挂载后缀
        if (toIdx > this.curLast) {
            for (let i = this.curLast + 1; i <= toIdx; i++) {
                await cells[i].mount(this.timelineEl, offsets[i]);
                const newH = cells[i].height;
                if (newH !== heights[i]) {
                    // 委托 manager 更新高度及偏移
                    this.manager.updateHeightAt(i, newH);
                }
            }
        }

        // 挂载前缀
        if (fromIdx < this.curFirst) {
            for (let i = fromIdx; i < this.curFirst; i++) {
                const ref = this.timelineEl.firstChild;             // ① 先记录当前首节点
                await cells[i].mount(this.timelineEl, offsets[i]);  // ② mount 会把 node 追加到尾部
                if (cells[i].height < 20) {
                    console.warn('[VS] suspicious tiny height', i, cells[i].height, cells[i]);
                }
                if (ref) this.timelineEl.insertBefore(cells[i].node, ref); // ③ 再插到最前
                const newH = cells[i].height;
                if (newH !== heights[i]) {
                    this.manager.updateHeightAt(i, newH);
                }
            }
        }

        this.curFirst = fromIdx;
        this.curLast = toIdx;

        console.log(`[VS] DOM count: ${this.timelineEl.childNodes.length}`);
    }

    private findFirstOverlap(top: number, offsets: number[]): number {
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

    private findLastOverlap(bottom: number, offsets: number[]): number {
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

    private computeVisibleRange(offsets: number[]): [number, number] {
        if (offsets.length === 1) return [0, -1];  // ← 空列表直接返回

        const scrollTop = window.scrollY || document.documentElement.scrollTop;
        const top = scrollTop - this.buffer;
        const bottom = scrollTop + window.innerHeight + this.buffer;
        return [
            this.findFirstOverlap(top, offsets),
            this.findLastOverlap(bottom, offsets)
        ];
    }

    /** 请求一次 diff；若当前 diff 正在执行，则只记录最新范围，稍后批处理 */
    private requestDiff(from: number, to: number): void {
        // 若 computeVisibleRange 返回空（to < from），规整
        if (to < from) to = from - 1;
        this.pendingRange = [from, to];
        if (!this.diffRunning) {
            this.runDiff();
        }
    }

    private async runDiff(): Promise<void> {
        const pr = this.pendingRange;
        if (!pr) return;
        this.pendingRange = null;
        this.diffRunning = true;
        try {
            await this.diffMountUnmount(pr[0], pr[1]);
        } finally {
            this.diffRunning = false;
        }
        // 如果期间又来了新范围，继续跑
        if (this.pendingRange) {
            this.runDiff();
        }
    }
}
