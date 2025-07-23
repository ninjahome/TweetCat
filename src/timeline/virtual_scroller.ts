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

    private static readonly BACKOFF_STEP = 20;      // 每次重试额外增加的延时
    private unstableTries = 0;
    private static readonly MAX_TRIES = 5;

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
            logVS(`[checkLite] curTop=${curTop}, lastTop=${this.lastTop}, maxDelta=${maxDelta}, threshold=${threshold}, need=${needUpdate}, fast=${isFastMode}`);
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
                // 统一用 scrollToTop，内部会写 lastTop + 清采样
                this.scrollToTop(res.targetTop);
                logVS(`[mountAtStablePosition] rollback scheduled to ${res.targetTop}`);
            } else {
                // 未回滚，直接用真实位置同步 lastTop
                const realTop = window.scrollY || document.documentElement.scrollTop;
                this.lastTop = realTop;
                this.scrollPositions = [];
                logVS(`[mountAtStablePosition] after mount: scrollY=${realTop}, lastTop=${this.lastTop}`);
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

        // 捕获当前 tries 用于 backoff
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
