/* ------------------------------------------------------------------
 * TweetCatCell 负责 “一条推文 DOM 的完整生命周期”
 * ------------------------------------------------------------------*/

import {EntryObj} from "./object_tweet";
import {renderTweetHTML} from "./tweet_render";

/** 等节点尺寸稳定 —— 和旧 waitForStableHeightSafe 一致 */
async function waitStable(node: HTMLElement, tries = 3, interval = 20) {
    let last = node.offsetHeight;
    while (tries-- > 0) {
        await new Promise(r => setTimeout(r, interval));
        const h = node.offsetHeight;
        if (Math.abs(h - last) < 1) break;
        last = h;
    }
}

/** 单独管理 ResizeObserver；测完即断 */
export class TweetCatCell {
    /* 公开只读：Manager/Scroller 会用到 */
    node!: HTMLElement;           // DOM 引用（mount 时创建）
    offset = 0;                   // translateY 像素
    height = 0;                   // 最终高度

    /* 私有 */
    private ro?: ResizeObserver;  // 行级 observer
    private measured = false;     // 是否已测量高度
    private inDom = false;

    constructor(
        private readonly data: EntryObj,
        private readonly tpl: HTMLTemplateElement
    ) {}

    /** 首次或再次挂载到父容器 */
    async mount(parent: HTMLElement, offset: number) {
        this.offset = offset;

        if (!this.node) {
            /* create DOM only once */
            this.node = renderTweetHTML(this.data, this.tpl);
            this.node.style.willChange = "transform";
            this.node.style.minHeight = "100px";

            /* observer 只对“未知高度”阶段起作用 */
            this.ro = new ResizeObserver(([e]) => {
                const newH = e.contentRect.height;
                if (newH !== this.height) {
                    this.height = newH;
                }
            });
            this.ro.observe(this.node);
        }

        /* 放进文档并定位 */
        Object.assign(this.node.style, {
            position: "absolute",
            left: 0,
            transform: `translateY(${this.offset}px)`,
            width: "100%",
            visibility: "visible"
        });
        parent.appendChild(this.node);
        this.inDom = true;

        /* 若尚未测量，等待稳定 → 记录高度 → 断开 observer */
        if (!this.measured) {
            await waitStable(this.node);
            this.height = this.node.offsetHeight;
            this.measured = true;
            this.ro?.disconnect();
            this.ro = undefined;
        }
    }

    /** 从文档移除，留待复用或 GC */
    unmount() {
        if (this.inDom && this.node.isConnected) {
            this.node.remove();
        }
        this.inDom = false;
    }

    /** 交互后显式更新高度（比再开 observer 更轻） */
    updateHeightManual(newH: number) {
        if (newH === this.height) return;
        this.height = newH;
    }
}
