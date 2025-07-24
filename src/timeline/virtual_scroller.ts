import {TweetManager} from "./div_cell_manager";
import {logVS} from "../debug_flags";

export class VirtualScroller {
    private isRendering = false;
    private lastTop = 0;

    private onScrollBound?: () => void;
    private pendingMountTimer: number | null = null;
    private lastDetectTop: number = 0;
    private scrollLocked = false;
    private scrollHappened = false;
    private static readonly FAST_RATIO = 3;
    private static readonly STABILIZE_DELAY = 80;  // ms
    private static readonly BACKOFF_STEP = 20;      // 每次重试额外增加的延时
    private unstableTries = 0;
    private static readonly MAX_TRIES = 5;
    private static readonly CHECK_FRAMES = 3;
    private scrollPositions: number[] = [];


    constructor(private readonly manager: TweetManager) {
        this.onScrollBound = this.onScroll.bind(this);
        window.addEventListener("scroll", this.onScrollBound, {passive: true});
        this.rafLoop();
    }

    public async initFirstPage() {
        this.isRendering = true;
        await this.manager.mountBatch(0, TweetManager.EST_HEIGHT * VirtualScroller.FAST_RATIO, true);
        this.isRendering = false;
        window.scrollTo(0, 0);
        this.lastTop = 0;
    }

    private onScroll(): void {
        this.scrollHappened = true;
    }

    private rafLoop = () => {
        requestAnimationFrame(async () => {
            if (this.scrollHappened && !this.isRendering) {
                this.scrollHappened = false;
                await this.rafTick();
            }
            this.rafLoop();
        });
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


    private checkLiteUpdate(): { needUpdate: boolean; curTop: number; isFastMode: boolean; } {

        const curTop = window.scrollY || document.documentElement.scrollTop;
        if (this.scrollLocked) return {needUpdate: false, curTop, isFastMode: false};

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

        logVS(`[checkLite] scrollPositions=${JSON.stringify(this.scrollPositions)}, lastTop=${this.lastTop}, curTop=${curTop}`);


        if (needUpdate) {
            this.scrollPositions = []; // 清空，准备下一轮
            logVS(`[checkLite] curTop=${curTop}, lastTop=${this.lastTop}, maxDelta=${maxDelta}, threshold=${threshold}, need=${needUpdate}, fast=${isFastMode}`);
        }

        return {needUpdate, curTop, isFastMode};
    }

    private rafTick = async () => {
        const {needUpdate, curTop, isFastMode} = this.checkLiteUpdate();
        if (!needUpdate) return;

        logVS(`[rafTick] trigger: curTop=${curTop}, window.innerHeight=${window.innerHeight}, timelineEl height=${this.manager['timelineEl'].style.height}`);
        logVS(`------>>> raf tick need to update: lastTop=${this.lastTop}  curTop=${curTop} fastMode=${isFastMode}`);
        this.scheduleMountAtStablePosition(curTop, isFastMode);
    }


    public scrollToTop(pos: number) {
        logVS(`[scrollToTop] trigger: pos=${pos}`);
        this.scrollLocked = true;
        this.scrollPositions = [];
        this.lastTop = pos; // 先设置，防止 checkLite 期间误判

        window.scrollTo(0, pos);

        waitScrollStabilize(() => {
            this.lastTop = window.scrollY;  // 最终确认
            this.scrollLocked = false;
            logVS(`[scrollToTop] stabilized at ${window.scrollY}, lock released`);
        });
    }

    private async mountAtStablePosition(curTop: number, isFastMode: boolean) {
        if (this.isRendering) {
            logVS(`[mountAtStablePosition] skip because isRendering=true`);
            return;
        }
        this.isRendering = true;

        logVS(`[mountAtStablePosition] start curTop=${curTop}, fast=${isFastMode}`);
        try {
            const res = await this.manager.mountBatch(curTop, window.innerHeight, isFastMode);

            if (res.needScroll && typeof res.targetTop === 'number') {
                this.scrollToTop(res.targetTop);
                logVS(`[mountAtStablePosition] rollback scheduled to ${res.targetTop}`);
            } else {
                // const realTop = window.scrollY || document.documentElement.scrollTop;
                // this.lastTop = realTop;
                // this.scrollPositions = [];
                // logVS(`[mountAtStablePosition] after mount: scrollY=${realTop}, lastTop=${this.lastTop}`);
            }
        } finally {
            this.isRendering = false;
            logVS(`[mountAtStablePosition] done lastTop=${this.lastTop}, isRendering=${this.isRendering}`);
        }
    }

    private scheduleMountAtStablePosition(curTop: number, isFastMode: boolean) {
        if (this.pendingMountTimer !== null) {
            logVS(`[schedule] clear previous timer ${this.pendingMountTimer}`);
            clearTimeout(this.pendingMountTimer);
        }
        this.lastDetectTop = curTop;

        const tries = ++this.unstableTries;
        const delay = VirtualScroller.STABILIZE_DELAY + (tries - 1) * VirtualScroller.BACKOFF_STEP;

        this.pendingMountTimer = window.setTimeout(async () => {
            const latestTop = window.scrollY || document.documentElement.scrollTop;
            const delta = Math.abs(latestTop - this.lastDetectTop);
            logVS(`[timerFire] @${performance.now().toFixed(1)}ms latestTop=${latestTop}, delta=${delta}, detectTop=${this.lastDetectTop}, tries=${tries}`);

            this.pendingMountTimer = null;

            if (delta <= TweetManager.EST_HEIGHT) {
                this.unstableTries = 0;
                await this.mountAtStablePosition(latestTop, isFastMode);
            } else if (tries < VirtualScroller.MAX_TRIES) {
                logVS(`[stabilizeCheck] unstable(delta=${delta}) retry #${tries}`);
                this.scheduleMountAtStablePosition(latestTop, isFastMode);
            } else {
                logVS(`[stabilizeCheck] give up after ${tries} tries (delta=${delta})`);
                this.unstableTries = 0;
            }
        }, delay);

        logVS(`[schedule] set timer id=${this.pendingMountTimer} delay=${delay} curTop=${curTop} fast=${isFastMode} try=${tries}`);
    }
}

export function waitScrollStabilize(onStabilized: () => void) {
    const EPSILON = 2;
    const MAX_STABLE_FRAMES = 6;
    let stableCount = 0;
    let lastY = -1;

    const targetY = window.scrollY || document.documentElement.scrollTop;

    const checkFrame = () => {
        const y = window.scrollY || document.documentElement.scrollTop;

        if (Math.abs(y - targetY) <= EPSILON) {
            if (y === lastY) {
                stableCount++;
            } else {
                stableCount = 1;
            }
        } else {
            stableCount = 0;
        }

        lastY = y;

        if (stableCount >= MAX_STABLE_FRAMES) {
            onStabilized();
        } else {
            requestAnimationFrame(checkFrame);
        }
    };

    requestAnimationFrame(checkFrame);
}
