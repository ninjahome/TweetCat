import {TweetManager} from "./div_cell_manager";
import {logVS} from "../debug_flags";

export class VirtualScroller {
    private isRendering = false;
    private lastTop = 0;

    private onScrollBound?: () => void;

    private pendingMountTimer: number | null = null;
    private lastDetectTop: number = 0;
    private static readonly FAST_RATIO = 3;
    private static readonly STABILIZE_DELAY = 80;  // ms

    constructor(private readonly manager: TweetManager) {
        this.onScrollBound = this.onScroll.bind(this);
        window.addEventListener("scroll", this.onScrollBound, {passive: true});
    }

    public async initFirstPage() {
        this.isRendering = true;
        await this.manager.mountBatch(0, TweetManager.EST_HEIGHT * VirtualScroller.FAST_RATIO, true);
        this.isRendering = false;
        window.scrollTo(0, 0);
        this.lastTop = 0;
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
        this.scheduleMountAtStablePosition(curTop, isFastMode);
    }

    dispose() {
        if (this.onScrollBound) {
            window.removeEventListener("scroll", this.onScrollBound);
            this.onScrollBound = undefined;
        }

        if (this.pendingMountTimer) {
            clearTimeout(this.pendingMountTimer);
            this.pendingMountTimer = null;
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
            return {needUpdate: false, curTop, isFastMode: false};
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

        return {needUpdate, curTop, isFastMode};
    }

    public scrollToTop(pos: number) {
        this.isRendering = true;          // 防止这一帧触发 rafTick
        window.scrollTo(0, pos);
        this.lastTop = pos;
        this.scrollPositions = [];        // 清空采样，避免 maxDelta 异常大
        // 用 setTimeout 0 或 rAF 再把 isRendering 置回 false
        requestAnimationFrame(() => {
            this.isRendering = false;
        });
        logVS(`[scrollToTop] pos=${pos}, lastTop(before)=${this.lastTop}`);
    }


    private scheduleMountAtStablePosition(curTop: number, isFastMode: boolean) {
        if (this.pendingMountTimer !== null) {
            clearTimeout(this.pendingMountTimer);
        }
        this.lastDetectTop = curTop;

        this.pendingMountTimer = window.setTimeout(async () => {
            const latestTop = window.scrollY || document.documentElement.scrollTop;
            const deltaSinceDetect = Math.abs(latestTop - this.lastDetectTop);

            logVS(`[stabilizeCheck] latestTop=${latestTop}, lastDetectTop=${this.lastDetectTop}, delta=${deltaSinceDetect}`);

            if (deltaSinceDetect <= TweetManager.EST_HEIGHT) {
                await this.mountAtStablePosition(latestTop, isFastMode);
            } else {
                logVS(`[stabilizeCheck] skipped mount: still unstable (delta=${deltaSinceDetect})`);
            }
            this.pendingMountTimer = null;
        }, VirtualScroller.STABILIZE_DELAY);
    }

    private async mountAtStablePosition(curTop: number, isFastMode: boolean) {
        if (this.isRendering) return;

        this.isRendering = true;
        // await this.manager.mountBatch(curTop, window.innerHeight, isFastMode);
        this.isRendering = false;
        this.lastTop = curTop;
    }

}
