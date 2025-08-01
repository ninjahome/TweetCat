import {MountResult, TweetManager} from "./div_cell_manager";
import {logVS} from "../debug_flags";
import {deferByFrames} from "../utils";

export class VirtualScroller {
    private isRendering = false;
    private lastTop = 0;
    private lastDetectedTop = 0;

    private onScrollBound?: () => void;
    private pendingMountTimer: number | null = null;
    private static readonly FAST_RATIO = 3;
    private static readonly STABILIZE_DELAY = 80;  // ms
    private static readonly BACKOFF_STEP = 20;      // 每次重试额外增加的延时
    private unstableTries = 0;
    private static readonly MAX_TRIES = 5;

    public scrollToTop(res: MountResult) {
        if (res.needScroll && typeof res.targetTop === 'number') {
            const pos = res.targetTop
            deferByFrames(() => {
                logVS(`[scrollToTop] start to scroll to ${pos}`);
                window.scrollTo(0, pos);
                this.lastTop = pos;
                this.isRendering = false;
            }, 2);
            logVS(`[mountAtStablePosition] rollback scheduled to ${res.targetTop}`);
        } else {
            this.lastTop = window.scrollY || document.documentElement.scrollTop;
            this.isRendering = false;
            logVS(`[mountAtStablePosition] no rollback  lastTop=${this.lastTop}`);
        }
    }

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
        // logVS(`------------------->>>>>>>>[onScroll]current scroll lastTop=${this.lastTop}, scrollY=${window.scrollY}`);
        if (this.isRendering) {
            return;
        }

        const {needUpdate, curTop, isFastMode} = this.scrollStatusCheck();
        if (!needUpdate) return;

        logVS(`[onScroll]need to update curTop=${curTop}, lastTop=${this.lastTop}, maxDelta=${this.lastTop - curTop}, fast=${isFastMode}`);

        this.isRendering = true;
        this.lastTop = curTop;
        requestAnimationFrame(async () => {
            this.scheduleMountAtStablePosition(curTop);
        })
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

    private scrollStatusCheck(): { needUpdate: boolean; curTop: number; isFastMode: boolean; } {
        const curTop = window.scrollY || document.documentElement.scrollTop;
        const delta = Math.abs(curTop - this.lastTop) //Math.max(...this.scrollPositions.map(t => ));
        const threshold = TweetManager.EST_HEIGHT;
        const isFastMode = delta >= VirtualScroller.FAST_RATIO * threshold;
        const needUpdate = delta >= threshold;
        return {needUpdate, curTop, isFastMode};
    }

    private scheduleMountAtStablePosition(startTop: number) {
        if (this.pendingMountTimer !== null) {
            logVS(`[schedule] clear previous timer ${this.pendingMountTimer}`);
            clearTimeout(this.pendingMountTimer);
        }
        this.lastDetectedTop = startTop;
        const tries = ++this.unstableTries;
        const delay = VirtualScroller.STABILIZE_DELAY + (tries - 1) * VirtualScroller.BACKOFF_STEP;

        this.pendingMountTimer = window.setTimeout(async () => {
            const latestTop = window.scrollY || document.documentElement.scrollTop;
            const delta = Math.abs(latestTop - this.lastDetectedTop);
            logVS(`[timerFire] @${performance.now().toFixed(1)}ms startTop==${startTop}, latestTop=${latestTop}, delta=${delta}, lastTop=${this.lastTop}, tries=${tries}`);

            this.pendingMountTimer = null;

            if (delta <= TweetManager.EST_HEIGHT) {
                this.unstableTries = 0;
                const isFastMode = Math.abs(latestTop - this.lastTop) >= VirtualScroller.FAST_RATIO * TweetManager.EST_HEIGHT;
                const res = await this.manager.mountBatch(this.lastDetectedTop, window.innerHeight, isFastMode);
                this.scrollToTop(res)
            } else if (tries < VirtualScroller.MAX_TRIES) {
                logVS(`[scheduleMountAtStablePosition] unstable(delta=${delta}) retry #${tries}  latestTop=${latestTop}, lastDetectedTop=${this.lastDetectedTop}`);
                this.scheduleMountAtStablePosition(latestTop);
            } else {
                logVS(`[scheduleMountAtStablePosition] give up after ${tries} tries (delta=${delta})`);
                this.unstableTries = 0;
                this.isRendering = false;
            }

        }, delay);

        logVS(`[schedule] set timer id=${this.pendingMountTimer} delay=${delay} lastTop=${this.lastTop} lastDetectedTop=${this.lastDetectedTop} try=${tries}`);
    }
}

