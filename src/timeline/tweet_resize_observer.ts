import {logTweetMgn} from "../common/debug_flags";

export type ResizeParam = {
    index: number;
    newHeight: number;
    isMoreAction: boolean;
}

export type UpdateFunc =  (index: number, newHeight: number, isMoreAct: boolean) => void;

type ResizeLogInfo = {
    index: number;
    lastHeight: number;
    onUpdate:UpdateFunc;
};

export class TweetResizeObserverManager {
    private observer: ResizeObserver;
    private cellMap = new WeakMap<HTMLElement, ResizeLogInfo>();

    private resizeQueue = new Map<HTMLElement, ResizeParam>();
    private debounceTimer: number | null = null;

    private readonly THRESHOLD = 2;        // px 以内变动忽略
    private readonly DEBOUNCE_MS = 20;     // 批处理节流延迟

    constructor() {
        this.observer = new ResizeObserver(entries => {
            for (const entry of entries) {
                this.handleResizeEntry(entry);
            }
            this.scheduleFlush(); // ✅ 只触发一次定时器
        });
    }

    /**
     * 注册节点并开始监听
     */
    observe(
        el: HTMLElement,
        index: number,
        onUpdate: UpdateFunc
    ) {
        if (!el) return;
        const lastHeight = el.offsetHeight || 0;
        this.cellMap.set(el, {index, lastHeight, onUpdate});
        this.observer.observe(el);
    }

    /**
     * 取消监听并清理记录
     */
    unobserve(el: HTMLElement) {
        this.observer.unobserve(el);
        this.cellMap.delete(el);
        this.resizeQueue.delete(el);
    }

    /**
     * 停止所有监听
     */
    disconnect() {
        this.observer.disconnect();
        this.cellMap = new WeakMap();
        this.resizeQueue.clear();
        if (this.debounceTimer !== null) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
    }

    /**
     * 收集单条尺寸变化
     */
    private handleResizeEntry(entry: ResizeObserverEntry) {
        const el = entry.target as HTMLElement;
        if (!el.isConnected) return;

        const info = this.cellMap.get(el);
        if (!info) return;

        const {index, lastHeight} = info;
        const newHeight = entry.contentRect.height;
        const delta = newHeight - lastHeight;

        if (Math.abs(delta) < this.THRESHOLD) return;

        const isMoreAction = el.dataset.isMoreAct === '1'
        this.resizeQueue.set(el, {index, newHeight, isMoreAction});
        el.dataset.isMoreAct = '0';
    }

    /**
     * 统一触发批处理
     */
    private scheduleFlush() {
        if (this.debounceTimer !== null) return;

        this.debounceTimer = window.setTimeout(() => {
            this.flushResizeQueue();
            this.debounceTimer = null;
        }, this.DEBOUNCE_MS);
    }

    /**
     * 批处理触发更新回调
     */
    private flushResizeQueue() {

        for (const [el, {index, newHeight, isMoreAction}] of this.resizeQueue.entries()) {
            const info = this.cellMap.get(el);
            if (!info) continue;

            const {onUpdate} = info;
            logTweetMgn(`[ResizeObserver] cell[${index}] height changed (debounced):${info.lastHeight} -> ${newHeight} isMoreAction=${isMoreAction}`);
            info.lastHeight = newHeight;
            onUpdate(index, newHeight, isMoreAction);
        }

        this.resizeQueue.clear();
    }
}

