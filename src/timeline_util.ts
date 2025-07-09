/* ------------------------------------------------------------------
 * 虚拟滚动数据结构
 * ------------------------------------------------------------------*/
export interface Slot {
    node: HTMLElement;
    height: number;
    top: number;
    attached: boolean;
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


export function binarySearch(y: number, slots: Slot[]): number {
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

