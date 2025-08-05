/* ------------------------------------------------------------------
 * TweetCatCell 负责单行 tweet 的 DOM 生命周期 + 手动高度上报
 * ------------------------------------------------------------------*/

import {EntryObj} from "./tweet_entry";
import {renderTweetHTML} from "./tweet_render";
import {globalNodePool} from "./div_node_pool";
import {logMount} from "../common/debug_flags";

async function waitStable(node: HTMLElement, tries = 3, interval = 20) {
    let last = node.offsetHeight;
    while (tries-- > 0) {
        await new Promise(r => setTimeout(r, interval));
        const h = node.offsetHeight;
        if (Math.abs(h - last) < 1) break;
        last = h;
    }
}

export class TweetCatCell {
    node!: HTMLElement;
    height = 0;
    private video?: HTMLVideoElement;
    private readonly id: string;

    constructor(
        private readonly data: EntryObj,
        private readonly tpl: HTMLTemplateElement,
        private readonly reportDh: (cell: TweetCatCell, dh: number) => void,
        public readonly index: number) {
        this.id = data.entryId;
    }

    /** 首次或再次挂载 */
    async mount(parent: HTMLElement, skipStable = false) {
        if (!this.node) {
            this.node = globalNodePool.acquire(this.id) ?? renderTweetHTML(this.data, this.tpl);
            globalNodePool.register(this, this.node);

            Object.assign(this.node.style, {
                position: "absolute",
                left: 0,
                visibility: "visible"
            });
            this.video = this.node.querySelector("video") ?? undefined;
        }

        parent.appendChild(this.node);

        if (this.video) {
            videoObserver.observe(this.video);
        }

        /* 若尚未测量，等待稳定后记录高度 */
        if (!skipStable && !this.height) {
            await waitStable(this.node);
            this.height = this.node.offsetHeight;
            logMount(`[Cell#${this.id}] mount  height=${this.height} }`);
        }

        logMount(`[Cell#${this.id}] mount skipStable=${skipStable}`);
    }

    /** 从 DOM 移除 */
    unmount() {
        logMount(`[Cell#${this.id}] unmount`);

        if (this.video) {
            videoObserver.unobserve(this.video);
        }

        if (this.node?.isConnected) this.node.remove();

        globalNodePool.unregister(this.node);
        globalNodePool.release(this.id, this.node);

        this.node = null as any;
    }

    /** 在交互或媒体 onload 时手动调用 */
    reportHeight(newH: number) {
        const dh = newH - this.height;
        if (!dh) return;
        this.height = newH;
        this.reportDh(this, dh);       // 汇报给核心 Manager
    }
}


const videoObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        const video = entry.target as HTMLVideoElement;
        if (entry.isIntersecting) {
            video.play().catch(err => {
                console.log("------>>> video play failed:", err)
            });
        } else {
            video.pause();
        }
    });
}, {
    root: null,
    threshold: 0.75
});
