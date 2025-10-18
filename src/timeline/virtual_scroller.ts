import {MountResult, TweetManager} from "./div_cell_manager";
import {logVS} from "../common/debug_flags";

export class VirtualScroller {
    private isRendering = false;
    private isPause = false;
    private lastTop = 0;
    private lastDetectedTop = 0;

    private onScrollBound?: () => void;
    private pendingMountTimer: number | null = null;
    private static readonly STABILIZE_DELAY = 80;  // ms
    private static readonly BACKOFF_STEP = 20;      // 每次重试额外增加的延时
    private unstableTries = 0;
    private static readonly MAX_TRIES = 5;

    public scrollToTop(res: MountResult) {
        setTimeout(()=>{
            document.documentElement.style.overflow = '';
        },1500);

        if (res.needScroll && typeof res.targetTop === 'number') {
            const pos = res.targetTop
            window.scrollTo(0, pos);
            this.lastTop = pos;
            this.isRendering = false;
            logVS(`[scrollToTop] start to scroll to ${pos} current scrollY=${window.scrollY} target top=${res.targetTop}`);
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
        document.documentElement.style.overflow = '';
        this.isRendering = true;
        await this.manager.mountBatch(0);
        this.isRendering = false;
        window.scrollTo(0, 0);
        this.lastTop = 0;
    }

    pause(): void {
        if (this.isPause) return;

        this.isPause = true;
        logVS("------->>> lastTop when pause:", this.lastTop, " window y:", window.scrollY)
    }

    resume(): void {
        if (!this.isPause) return;

        logVS("------->>>before lastTop when resume:", this.lastTop, " window y:", window.scrollY)
        requestAnimationFrame(() => {
            window.scrollTo(0, this.lastTop);
            requestAnimationFrame(() => {
                logVS("------->>>after lastTop when resume:", this.lastTop, " window y:", window.scrollY)
                this.isPause = false;
            })
        })
    }

    private onScroll(): void {
        if (this.isPause) return; // 保留暂停逻辑
        const { needUpdate, curTop, isBottom } = this.scrollStatusCheck();
        if (!needUpdate) return;
        // ===== 原有逻辑保持不动 =====
        if (this.isRendering) {
            if (!isBottom) return;
            const html = document.documentElement;
            html.style.overflow = 'hidden';
            logVS(`[触底检测] scrollTop=${curTop}`);
            return;
        }

        logVS(`[onScroll]need to update curTop=${curTop}, lastTop=${this.lastTop}, maxDelta=${this.lastTop - curTop}`);

        this.isRendering = true;
        this.lastTop = curTop;

        requestAnimationFrame(async () => {
            this.scheduleMountAtStablePosition(curTop);
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
        this.isPause = false;

        document.documentElement.style.overflow = '';
    }

    private scrollStatusCheck(): { needUpdate: boolean; curTop: number; isBottom: boolean } {
        // === 原始滚动检测逻辑 ===
        const curTop = window.scrollY || document.documentElement.scrollTop;
        const delta = Math.abs(curTop - this.lastTop);
        const threshold = TweetManager.EST_HEIGHT;
        const needUpdate = delta >= threshold;

        // === 新增：滚动边界检测 ===
        const html = document.documentElement;
        const scrollHeight = html.scrollHeight;
        const clientHeight = html.clientHeight;
        const distanceToBottom = scrollHeight - (curTop + clientHeight);
        const isBottom = distanceToBottom === 0;

        logVS(`[VirtualScroller] [scrollStatusCheck] curTop=${curTop}, scrollHeight=${scrollHeight}, clientHeight=${clientHeight}, distanceToBottom=${distanceToBottom}, isBottom=${isBottom}`);

        return { needUpdate, curTop, isBottom };
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
                const res = await this.manager.mountBatch(this.lastDetectedTop);
                this.scrollToTop(res)
            } else if (tries < VirtualScroller.MAX_TRIES) {
                logVS(`[scheduleMountAtStablePosition] unstable(delta=${delta}) retry #${tries}  latestTop=${latestTop}, lastDetectedTop=${this.lastDetectedTop}`);
                this.scheduleMountAtStablePosition(latestTop);
            } else {
                logVS(`[scheduleMountAtStablePosition] give up after ${tries} tries (delta=${delta})`);
                this.unstableTries = 0;
                this.scrollToTop({needScroll:true,targetTop:this.lastDetectedTop})
            }

        }, delay);

        logVS(`[schedule] set timer id=${this.pendingMountTimer} delay=${delay} lastTop=${this.lastTop} lastDetectedTop=${this.lastDetectedTop} try=${tries}`);
    }
}

