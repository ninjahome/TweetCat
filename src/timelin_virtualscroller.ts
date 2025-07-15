import {TweetManager} from "./timeline_manager";
import {TweetCatCell} from "./timeline_tweet_obj";

export class VirtualScroller {
    private buffer = 600;
    private loadingMore = false;

    // ① 差分挂载状态
    private curFirst = 0;
    private curLast = -1;

    constructor(
        private readonly timelineEl: HTMLElement,
        private readonly tpl: HTMLTemplateElement,
        private readonly manager: TweetManager,
    ) {
        this.onScroll = this.onScroll.bind(this);
        window.addEventListener("scroll", this.onScroll, {passive: true});
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
        console.log(`[VS] range: ${fromIdx}→${toIdx}`);
        return [fromIdx, toIdx];
    }

    /** ③ 差分挂载/卸载：把 diffMountUnmount 也搬进来 */
    private diffMountUnmount(fromIdx: number, toIdx: number, cells: TweetCatCell[]) {
        // 卸载前缀
        for (let i = this.curFirst; i < fromIdx; i++) {
            cells[i].unmount();
        }
        // 卸载后缀
        for (let i = this.curLast; i > toIdx; i--) {
            cells[i].unmount();
        }
        // 挂载前段
        const firstNode = this.timelineEl.firstChild;
        for (let i = fromIdx; i < this.curFirst; i++) {
            cells[i].mount(this.timelineEl, cells[i].offset);
            if (firstNode) this.timelineEl.insertBefore(cells[i].node, firstNode);
        }
        // 挂载尾段
        for (let i = this.curLast + 1; i <= toIdx; i++) {
            cells[i].mount(this.timelineEl, cells[i].offset);
            this.timelineEl.appendChild(cells[i].node);
        }
        this.curFirst = fromIdx;
        this.curLast = toIdx;
    }

    /** 主滚动处理 */
    private onScroll() {
        const cells = this.manager.getCells();
        const [fromIdx, toIdx] = this.computeVisibleRange(cells);
        this.diffMountUnmount(fromIdx, toIdx, cells);
        // 触底加载
        if (!this.loadingMore && toIdx >= cells.length - 1) {
            this.loadingMore = true;
            this.manager.loadMoreData(this.tpl).finally(() => this.loadingMore = false);
        }
    }

    dispose() {
        window.removeEventListener("scroll", this.onScroll);
    }
}
