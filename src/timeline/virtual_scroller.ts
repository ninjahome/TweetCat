import {TweetManager} from "./div_cell_manager";
import {logVS} from "../debug_flags";

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


    private scrollLocked = false;
    private static readonly EDGE_EPS = 4; // px

    private atBottom(): boolean {
        const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
        return Math.abs(window.scrollY - maxScroll) <= VirtualScroller.EDGE_EPS;
    }

    /** 只负责把视口从底部挪开 1px */
    private unlockBottomAnchor() {
        if (this.atBottom()) {
            logVS(`[unlockBottomAnchor] touch bottom lastTop=${this.lastTop} scrollY=${window.scrollY} `);
            window.scrollTo(0, window.scrollY - VirtualScroller.EDGE_EPS);
        }
    }

    private addTempBottomPad(px = 120): HTMLElement {
        const pad = document.createElement("div");
        pad.style.cssText = `
        height:${px}px;
        width:100%;
        background:red;   /* 方便肉眼看到 */
        pointer-events:none;
    `;

        /* 记录插 pad 前 scrollHeight */
        const before = document.documentElement.scrollHeight;
        const beforeH = parseFloat(this.manager.timelineEl.style.height) || 0;

        this.manager.timelineEl.appendChild(pad);
        this.manager.timelineEl.style.height = `${beforeH + px}px`;

        /* 插 pad 后再次打印 scrollHeight */
        const after = document.documentElement.scrollHeight;
        logVS(`[pad] add ${px}px, timelineEl.height ${beforeH}px → ${beforeH + px}px; `
            + `scrollHeight ${before}px → ${after}px`);

        return pad;
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
        if (this.scrollLocked || this.isRendering) {
            return;
        }

        const {needUpdate, curTop, isFastMode} = this.checkLiteUpdate();
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


    private checkLiteUpdate(): { needUpdate: boolean; curTop: number; isFastMode: boolean; } {

        const curTop = window.scrollY || document.documentElement.scrollTop;
        const delta = Math.abs(curTop - this.lastTop) //Math.max(...this.scrollPositions.map(t => ));
        const threshold = TweetManager.EST_HEIGHT;
        const isFastMode = delta >= VirtualScroller.FAST_RATIO * threshold;
        const needUpdate = delta >= threshold;

        return {needUpdate, curTop, isFastMode};
    }

    public bottomPad: HTMLElement | null = null;
    static readonly EXTRA_GAP = 120;

    public ensureBottomPad(listHeight: number, buffer: number) {
        if (!this.bottomPad) {          // 只在第一次创建
            const pad = document.createElement('div');
            pad.style.cssText = `
           position:absolute;
           left:0;
           height:${VirtualScroller.EXTRA_GAP}px;
           width:100%;
           background:red;          /* 验证阶段可见，最终去掉 */
           pointer-events:none;
        `;
            this.manager.timelineEl.appendChild(pad);
            this.bottomPad = pad;
        }
        this.bottomPad!.style.top = `${listHeight + buffer}px`;   // 始终贴在最新底部
    }

    private async mountAtStablePosition(startView: number, isFastMode: boolean) {
        logVS(`[mountAtStablePosition] start startView=${startView} lastTop=${this.lastTop}, fast=${isFastMode}`);
        const res = await this.manager.mountBatch(startView, window.innerHeight, isFastMode);
        if (res.needScroll && typeof res.targetTop === 'number') {
            await this.scrollToTop(res.targetTop);           // ← 等回滚完
            logVS(`[mountAtStablePosition] rollback done → ${res.targetTop}`);
            return;
        }

        this.lastTop = window.scrollY;
        await this.finishRenderingSafely();                // ← 真正重置 isRendering
        logVS(`[mountAtStablePosition] settle, lastTop=${this.lastTop}`);
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
                await this.mountAtStablePosition(this.lastDetectedTop, isFastMode);
            } else if (tries < VirtualScroller.MAX_TRIES) {
                logVS(`[stabilizeCheck] unstable(delta=${delta}) retry #${tries}  latestTop=${latestTop}, lastDetectedTop=${this.lastDetectedTop}`);
                this.scheduleMountAtStablePosition(latestTop);
            } else {
                logVS(`[stabilizeCheck] give up after ${tries} tries (delta=${delta})`);
                this.unstableTries = 0;
                this.isRendering = false;
            }

        }, delay);

        logVS(`[schedule] set timer id=${this.pendingMountTimer} delay=${delay} lastTop=${this.lastTop} lastDetectedTop=${this.lastDetectedTop} try=${tries}`);
    }


    /** 把视口安全移到 targetTop，Promise resolve 时滚动已稳定 */
    public scrollToTop(targetTop: number): Promise<void> {
        return new Promise(resolve => {
            this.ensureBottomPad(this.manager.listHeight, this.manager.bufferPx);
            this.scrollLocked = true;
            this.lastTop = targetTop;

            requestAnimationFrame(() => {          // rAF‑A
                requestAnimationFrame(() => {        // rAF‑B
                    window.scrollTo(0, targetTop);

                    requestAnimationFrame(() => {      // rAF‑C
                        Promise.resolve().then(() => {
                            this.scrollLocked = false;
                            resolve();                     // <- 释放给调用方
                        });
                    });
                });
            });
        });
    }

    private async finishRenderingSafely() {
        await this.waitScrollSettled(3);
        this.isRendering = false;
        logVS(`[finishRenderingSafely] done, isRendering=${this.isRendering}, scrollY=${window.scrollY}`);
    }

    /** 连续 stableFrames 帧 scrollY 误差 ≤ threshold 视为稳定 */
    private waitScrollSettled(threshold = 1, stableFrames = 2): Promise<void> {
        return new Promise(resolve => {
            let last = window.scrollY, stable = 0;
            const tick = () => {
                const cur = window.scrollY;
                if (Math.abs(cur - last) <= threshold) {
                    if (++stable >= stableFrames) return resolve();
                } else {
                    stable = 0;
                    last = cur;
                }
                requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
        });
    }

}

// utils/timing.ts
export function deferByFrames(callback: () => void, frameCount: number = 3): void {
    const step = (n: number) => {
        if (n <= 1) {
            requestAnimationFrame(() => callback());
        } else {
            requestAnimationFrame(() => step(n - 1));
        }
    };
    step(frameCount);
}
