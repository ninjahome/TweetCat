import {TweetManager} from "./div_cell_manager";
import {logAnchor, logMount} from "../debug_flags";

export class VirtualScroller {
    /* ---------------- 原有字段 ---------------- */
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
    private minLoadInterval = 350;        // ms
    private prefetchPxFactor = 2;         // 预取 2 屏

    /** 滚动锚定补偿累计（上方高度变化时由 Manager.queueAnchor 调用） */
    private anchorDh = 0;

    /* ---------------- Lite 模式字段 ---------------- */
    /** Lite 模式：上一次已处理的 scrollTop（阈值累积基准） */
    private liteLastTop = 0;
    /** Lite 模式启用标志 */
    private liteEnabled = false;
    /** Lite 模式滚动监听引用（方便移除） */
    private liteOnScrollBound?: () => void;

    /* ---------------- 构造 ---------------- */
    constructor(
        private readonly timelineEl: HTMLElement,
        private readonly manager: TweetManager,
    ) {
        this.onScroll = this.onScroll.bind(this);
        this.rafLoop = this.rafLoop.bind(this);

        /* ❌ 默认停用原高频 scroll 逻辑；Lite 模式会另行绑定 */
        // window.addEventListener("scroll", this.onScroll, { passive: true });

        this.onResize = this.onResize.bind(this);
        window.addEventListener("resize", this.onResize);

        this.updateBuffer();

        /* ❌ 默认停用原 rafLoop；Lite 模式不需要 */
        // this.rafLoop();

        this.enableLiteMode();
    }

    /* ---------------- 原有公共接口（保持不动，必要时仍可用） ---------------- */

    /** Manager 通知：上方高度变动 dh，需要在下一帧 scrollBy 补偿 */
    public queueAnchor(dh: number): void {
        logAnchor(
            `[VS] Anchor queued dh=${dh} totalDh=${this.anchorDh + dh} scrollTop=${window.scrollY}`
        );
        this.anchorDh += dh;
        this.scrollPending = true;
    }

    /** 提供给 Manager：当前可视首 index */
    public getCurFirst(): number {
        return this.curFirst;
    }

    /** 强制刷新，可用于首次渲染或手动触发更新视图 */
    public refresh(): void {
        /* Lite 模式下仅标记 scrollPending，实际行为由 Lite 逻辑决定 */
        this.scrollPending = true;
    }

    dispose() {
        /* 原 scroll 监听（默认未启用） */
        // window.removeEventListener("scroll", this.onScroll);
        this.disableLiteMode();
        window.removeEventListener("resize", this.onResize);
    }

    /* ---------------- Lite 模式 API ---------------- */

    /**
     * 启用 Lite 模式：只挂载首屏数据；后续滚动仅打印
     * “需要 / 跳过 更新”日志，不做挂载/卸载。
     */
    public async enableLiteMode(): Promise<void> {
        if (this.liteEnabled) return;
        this.liteEnabled = true;

        // 1) 挂载首屏
        await this.liteMountInitialBatch();

        // 2) 初始化滚动基准
        this.liteLastTop = window.scrollY || document.documentElement.scrollTop;

        // 3) 轻量滚动监听
        this.liteOnScrollBound = this.liteOnScroll.bind(this);
        window.addEventListener("scroll", this.liteOnScrollBound, {passive: true});

        console.log("[VS-lite] enabled");
    }

    /** 可选：停用 Lite 模式，移除轻量监听 */
    public disableLiteMode(): void {
        if (!this.liteEnabled) return;
        this.liteEnabled = false;
        if (this.liteOnScrollBound) {
            window.removeEventListener("scroll", this.liteOnScrollBound);
            this.liteOnScrollBound = undefined;
        }
        console.log("[VS-lite] disabled");
    }

    /* ---------------- Lite 模式内部实现 ---------------- */

    /** Lite：挂载首屏 tweets，直到填满视口高度 */
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
        logMount(`[VS-lite] initial mounted 0..${last} (px=${acc})`);
    }

    /** Lite：滚动时只做 Δ 计算并打印日志 */
    private liteOnScroll(): void {
        if (!this.liteEnabled) return;

        const cur = window.scrollY || document.documentElement.scrollTop;
        const delta = Math.abs(cur - this.liteLastTop);
        const threshold = this.manager.getEstHeight();

        if (delta >= threshold) {
            console.log(`[VS-lite] need update tweets delta=${delta} >= threshold=${threshold}`);
            this.liteLastTop = cur; // 更新基准
            const pr = this.computeVisibleRange(this.manager.getOffsets())
            this.diffMountUnmount(pr[0], pr[1]).then(() => {
                console.log(`[VS-lite] compute visible range from =${pr[0]} to=${pr[1]}`);
            });
        } else {
            // console.log(`[VS-lite] skip update delta=${delta} < threshold=${threshold}`);
        }
    }

    /* ---------------- 原有 scroll / resize / rafLoop 逻辑（默认停用） ---------------- */
    private onScroll() {
        this.scrollPending = true;
        this.scrollEvents++;
    }

    private onResize() {
        this.updateBuffer();
    }

    private updateBuffer() {
        this.buffer = window.innerHeight * 1.2;
    }

    /* ---------- 以下函数保留以备将来恢复复杂逻辑；Lite 模式不会调用 ---------- */
    private rafLoop(): void {
        requestAnimationFrame(() => {
            const curScrollTop = window.scrollY || document.documentElement.scrollTop;

            if (this.scrollPending || curScrollTop !== this.lastScrollTop) {
                this.scrollPending = false;
                this.lastScrollTop = curScrollTop;
                this.rafUpdates++;
                const offsets = this.manager.getOffsets();
                const [fromIdx, toIdx] = this.computeVisibleRange(offsets);
                logMount(`[VS] visRange from=${fromIdx} to=${toIdx} len=${toIdx >= fromIdx ? (toIdx - fromIdx + 1) : 0}`);
                this.requestDiff(fromIdx, toIdx);
            }


            // ---- 锚定补偿（上方高度变化）----
            if (this.anchorDh !== 0) {
                const before = window.scrollY || document.documentElement.scrollTop;
                logAnchor(`[VS] Anchor apply scrollBy(${this.anchorDh}) from=${before}`);
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
                console.log(`[VS] Trigger loadMoreData (chkTo=${chkTo}, cells=${cellsLen}, pixelNeed=${pixelNeed})`);
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
        logMount(`[VS] diffMountUnmount IN  curFirst=${this.curFirst} curLast=${this.curLast} -> ${fromIdx}..${toIdx}`);

        const cells = this.manager.getCells();
        const offsets = this.manager.getOffsets();
        const heights = this.manager.getHeights();

        const lastValid = cells.length - 1;
        if (toIdx > lastValid) toIdx = lastValid;
        if (fromIdx < 0) fromIdx = 0;

        if (toIdx < fromIdx) {
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

        logMount(`[VS] diffMountUnmount OUT curFirst=${this.curFirst} curLast=${this.curLast}  DOM=${this.timelineEl.childNodes.length}`);
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
        if (offsets.length === 1) return [0, -1];

        const scrollTop = window.scrollY || document.documentElement.scrollTop;
        const top = scrollTop - this.buffer;
        const bottom = scrollTop + window.innerHeight + this.buffer;
        return [
            this.findFirstOverlap(top, offsets),
            this.findLastOverlap(bottom, offsets),
        ];
    }

    /** 请求一次 diff；若当前 diff 正在执行，则只记录最新范围，稍后批处理 */
    private requestDiff(from: number, to: number): void {
        if (to < from) to = from - 1;
        logMount(`[VS] requestDiff from=${from} to=${to} diffRunning=${this.diffRunning}`);
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
        logMount(`[VS] runDiff start from=${pr[0]} to=${pr[1]}`);
        try {
            await this.diffMountUnmount(pr[0], pr[1]);
        } finally {
            this.diffRunning = false;
        }

        logMount(`[VS] runDiff end   from=${pr[0]} to=${pr[1]} nextPending=${this.pendingRange ? "Y" : "N"}`);

        if (this.pendingRange) {
            this.runDiff();
        }
    }
}
