/* ------------------------------------------------------------------
 * 虚拟滚动数据结构
 * ------------------------------------------------------------------*/

// TimelineRow 类定义（只保留一份）
export class TimelineRow {
    node: HTMLElement;
    height: number;
    top: number;
    attached: boolean;
    private _ro?: ResizeObserver;

    constructor(node: HTMLElement, height: number, top: number, attached = true) {
        this.node = node;
        this.height = height;
        this.top = top;
        this.attached = attached;
    }

    setTop(newTop: number) {
        this.top = newTop;
        this.node.style.top = `${newTop}px`;
    }

    attachObserver(ro: ResizeObserver) {
        this._ro = ro;
    }

    disconnectObserver() {
        if (this._ro) {
            this._ro.disconnect();
            this._ro = undefined;
        }
    }
}
/* ------------------------------------------------------------------
 * DOM utils – 隐藏 / 显示原生 TimeLine
 * ------------------------------------------------------------------*/
export function hideOriginalTweetArea(el: HTMLElement) {
    Object.assign(el.style, {
        position: "absolute",
        top: "-9999px",
        left: "-9999px",
        width: "1px",
        height: "1px",
        overflow: "hidden",
        pointerEvents: "none",
        visibility: "hidden",
    } as CSSStyleDeclaration);
}

export function showOriginalTweetArea(el: HTMLElement) {
    Object.assign(el.style, {
        position: "",
        top: "",
        left: "",
        width: "",
        height: "",
        overflow: "",
        pointerEvents: "",
        visibility: "",
    } as CSSStyleDeclaration);
}


export function binarySearch(y: number, slots: TimelineRow[]): number {
    let l = 0,
        r = slots.length - 1,
        ans = slots.length;
    while (l <= r) {
        const m = (l + r) >> 1;
        const s = slots[m];
        if (s.top + s.height < y) {
            l = m + 1;
        } else {
            ans = m;
            r = m - 1;
        }
    }
    return ans;
}

/* ------------------------------------------------------------------
 * wait for two stable frames – 避免测量期抖动
 * ------------------------------------------------------------------*/
export function waitForStableHeight(el: HTMLElement): Promise<void> {
    return new Promise((resolve) => {
        let last = el.offsetHeight;
        let stable = 0;
        const check = () => {
            const h = el.offsetHeight;
            if (h === last) stable++;
            else {
                stable = 0;
                last = h;
            }
            if (stable >= 2) resolve();
            else requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
    });
}

