import {TweetManager} from "./manager";
import {TweetCatCell} from "./tweet_div_cell";

export class VirtualScroller {
    private buffer = 0;
    private loadingMore = false;
    private scrollPending = false;

    // ① 差分挂载状态
    private curFirst = 0;
    private curLast = -1;

    private scrollEvents = 0;
    private rafUpdates = 0;

    constructor(
        private readonly timelineEl: HTMLElement,
        private readonly tpl: HTMLTemplateElement,
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

    private onResize() {
        this.updateBuffer();
    }

    private updateBuffer() {
        this.buffer = window.innerHeight * 1.2;
        console.log(`[VS] Buffer updated: ${this.buffer}px`);
    }

    private findFirstOverlap(top: number, cells: TweetCatCell[]): number {
        let l = 0, r = cells.length - 1, ans = cells.length;
        while (l <= r) {
            const m = (l + r) >> 1;
            if (cells[m].offset + cells[m].height > top) {
                ans = m;
                r = m - 1;
            } else {
                l = m + 1;
            }
        }
        return ans;
    }

    private findLastOverlap(bottom: number, cells: TweetCatCell[]): number {
        let l = 0, r = cells.length - 1, ans = -1;
        while (l <= r) {
            const m = (l + r) >> 1;
            if (cells[m].offset < bottom) {
                ans = m;
                l = m + 1;
            } else {
                r = m - 1;
            }
        }
        return ans;
    }

    /** ② 可见区计算 */
    private computeVisibleRange(cells: TweetCatCell[]): [number, number] {
        const scrollTop = window.scrollY || document.documentElement.scrollTop;
        const vh = window.innerHeight;
        const visibleTop = scrollTop - this.buffer;
        const visibleBottom = scrollTop + vh + this.buffer;
        const fromIdx = this.findFirstOverlap(visibleTop, cells);
        const toIdx = this.findLastOverlap(visibleBottom, cells);
        return [fromIdx, toIdx];
    }

    /** 主滚动处理 */
    private onScroll() {
        this.scrollPending = true;
        this.scrollEvents++;
    }

    dispose() {
        window.removeEventListener("scroll", this.onScroll);
        window.removeEventListener("resize", this.onResize);
    }

    private lastScrollTop = 0;

    private rafLoop() {
        requestAnimationFrame(() => {
            const currentScrollTop = window.scrollY || document.documentElement.scrollTop;
            if (this.scrollPending || currentScrollTop !== this.lastScrollTop) {
                this.scrollPending = false;
                this.lastScrollTop = currentScrollTop;
                this.rafUpdates++;

                // console.log(`[VS] RAF update #${this.rafUpdates} / scrolls: ${this.scrollEvents} @ ${performance.now().toFixed(2)}ms`);

                const cells = this.manager.getCells();
                const [fromIdx, toIdx] = this.computeVisibleRange(cells);
                this.diffMountUnmount(fromIdx, toIdx, cells);
                console.log(`[VS] Current DOM count: ${this.timelineEl.childNodes.length}`);
                // 触底加载
                if (!this.loadingMore && toIdx >= cells.length - 1) {
                    this.loadingMore = true;
                    console.log(`[VS] Trigger loadMoreData at index=${toIdx}`);
                    this.manager.loadMoreData(this.tpl).finally(() => this.loadingMore = false);
                }
            }
            this.rafLoop();
        });
    }

    private diffMountUnmount(fromIdx: number, toIdx: number, cells: TweetCatCell[]) {
        if (fromIdx === this.curFirst && toIdx === this.curLast) {
            console.log(`[VS] diffMountUnmount skipped, same range: ${fromIdx} → ${toIdx}`);
            return;
        }
        console.log(`[VS] visible index range: ${fromIdx} → ${toIdx}`);

        // ========== 前向滚动（下滑） ==========
        if (fromIdx > this.curFirst) {
            console.log(`[VS] Unmount prefix: ${this.curFirst} to ${fromIdx - 1}`);
            for (let i = this.curFirst; i < fromIdx; i++) {
                cells[i].unmount();
            }
        }
        if (toIdx > this.curLast) {
            console.log(`[VS] Mount suffix: ${this.curLast + 1} to ${toIdx}`);
            for (let i = this.curLast + 1; i <= toIdx; i++) {
                cells[i].mount(this.timelineEl, cells[i].offset);
                this.timelineEl.appendChild(cells[i].node);
            }
        }

        // ========== 后向滚动（上滑） ==========
        if (fromIdx < this.curFirst) {
            console.log(`[VS] Mount prefix: ${fromIdx} to ${this.curFirst - 1}`);
            const firstNode = this.timelineEl.firstChild;
            for (let i = fromIdx; i < this.curFirst; i++) {
                cells[i].mount(this.timelineEl, cells[i].offset);
                if (firstNode) this.timelineEl.insertBefore(cells[i].node, firstNode);
            }
        }
        if (toIdx < this.curLast) {
            console.log(`[VS] Unmount suffix: ${toIdx + 1} to ${this.curLast}`);
            for (let i = toIdx + 1; i <= this.curLast; i++) {
                cells[i].unmount();
            }
        }

        this.curFirst = fromIdx;
        this.curLast = toIdx;
    }

}
