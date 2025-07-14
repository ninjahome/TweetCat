/* ------------------------------------------------------------------
 * 虚拟滚动数据结构
 * ------------------------------------------------------------------*/

// TimelineRow 类定义（只保留一份）
export class TimelineRow {
    node: HTMLElement;
    height: number;
    top: number;

    constructor(node: HTMLElement, height: number, top: number) {
        this.node = node;
        this.height = height;
        this.top = top;
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


/** 小工具：返回 <= value 的最后一个索引 */
function binarySearch(arr: number[], value: number) {
    let l = 0, r = arr.length - 1;
    while (l <= r) {
        const m = (l + r) >> 1;
        if (arr[m] <= value) l = m + 1;
        else r = m - 1;
    }
    return r;
}