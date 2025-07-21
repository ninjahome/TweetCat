import {TweetManager} from "./div_cell_manager";
import {logVS} from "../debug_flags";

export class VirtualScroller {
    private isRendering = false;
    private lastTop = 0;

    private onScrollBound?: () => void;

    private static readonly FAST_RATIO = 3;

    constructor(private readonly manager: TweetManager) {
        this.onScrollBound = this.onScroll.bind(this);
        window.addEventListener("scroll", this.onScrollBound, {passive: true});
        this.lastTop = window.scrollY || document.documentElement.scrollTop;
    }

    public async initFirstPage() {
        this.isRendering = true;
        const top = window.scrollY || document.documentElement.scrollTop;
        await this.manager.mountBatch(top, top + TweetManager.EST_HEIGHT * VirtualScroller.FAST_RATIO, true);
        this.isRendering = false;
    }

    private onScroll(): void {
        if (this.isRendering) return;
        requestAnimationFrame(this.rafTick);
    }

    private rafTick = async () => {
        if (this.isRendering) return;

        const {needUpdate, curTop, isFastMode} = this.checkLiteUpdate();
        if (!needUpdate) return;
        // ✅ 只在确实要更新时记录
        logVS(`[rafTick] trigger: curTop=${curTop}, window.innerHeight=${window.innerHeight}, timelineEl height=${this.manager['timelineEl'].style.height}`);
        logVS(`------>>> raf tick need to update: lastTop=${this.lastTop}  curTop=${curTop} fastMode=${isFastMode}`)

        const bottom = curTop + window.innerHeight;
        this.isRendering = true;
        await this.manager.mountBatch(curTop, bottom, isFastMode);
        this.isRendering = false;
        this.lastTop = curTop;
    }

    dispose() {
        if (this.onScrollBound) {
            window.removeEventListener("scroll", this.onScrollBound);
            this.onScrollBound = undefined;
        }
        this.isRendering = false;
        this.lastTop = 0;
    }

    private scrollPositions: number[] = [];
    private static readonly CHECK_FRAMES = 3;

    private checkLiteUpdate(): { needUpdate: boolean; curTop: number; isFastMode: boolean; } {
        const curTop = window.scrollY || document.documentElement.scrollTop;
        this.scrollPositions.push(curTop);

        if (this.scrollPositions.length < VirtualScroller.CHECK_FRAMES) {
            return { needUpdate: false, curTop, isFastMode: false };
        }
        if (this.scrollPositions.length > VirtualScroller.CHECK_FRAMES) {
            this.scrollPositions.shift();
        }

        const maxDelta = Math.max(...this.scrollPositions.map(t => Math.abs(t - this.lastTop)));
        const threshold = TweetManager.EST_HEIGHT;
        const isFastMode = maxDelta >= VirtualScroller.FAST_RATIO * threshold;
        const needUpdate = maxDelta >= threshold;

        if (needUpdate) {
            this.scrollPositions = []; // 清空，准备下一轮
        }

        return { needUpdate, curTop, isFastMode };
    }
}
