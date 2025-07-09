import {observeSimple} from "./utils";
import {parseContentHtml} from "./content";
import {fetchTweets} from "./tweet_api";
import {renderTweetHTML} from "./tweet_render";

/**
 * Route used when我们切换到自定义时间线时，写入到 location.hash
 */
const selfDefineUrl = "tweetCatTimeLine";

/* ------------------------------------------------------------------
 * Debug & helpers
 * ------------------------------------------------------------------*/
const DEBUG = true;
const log = (...args: unknown[]) => DEBUG && console.debug(...args);

/* ResizeObserver 调试用：打印元素实时尺寸 */
function watchSize(el: HTMLElement, label: string) {
    const ro = new ResizeObserver(([e]) => {
        const {width, height} = e.contentRect;
        log(`[size] ${label} -> ${width}×${height}px`);
    });
    ro.observe(el);
    // @ts-ignore
    el._watchRO = ro;
}

/* ------------------------------------------------------------------
 * DOM util – 隐藏 / 显示原生 TimeLine
 * ------------------------------------------------------------------*/
function hideOriginalTweetArea(el: HTMLElement) {
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

function showOriginalTweetArea(el: HTMLElement) {
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

/* ------------------------------------------------------------------
 * 虚拟滚动数据结构
 * ------------------------------------------------------------------*/
interface Slot {
    node: HTMLElement;
    height: number;
    top: number;
    attached: boolean;
}

let slots: Slot[] = [];
let timelineEl: HTMLElement; // tweetTimeline ref

const ONE_SCREEN = () => timelineEl?.clientHeight ?? 800; // fall‑back

/* ------------------------------------------------------------------
 * Height compensation helpers
 * ------------------------------------------------------------------*/
function adjustOffsets(startIdx: number, dh: number) {
    if (!dh) return;
    for (let i = startIdx + 1; i < slots.length; i++) {
        slots[i].top += dh;
        if (slots[i].attached) {
            slots[i].node.style.top = slots[i].top + "px";
        }
    }
    const newH = (parseFloat(timelineEl.style.height || "0") + dh).toFixed(3);
    timelineEl.style.height = newH + "px";
}

function observeSlotHeight(slot: Slot, idx: number, label: string) {
    const ro = new ResizeObserver(([e]) => {
        const newH = e.contentRect.height;
        const dh = newH - slot.height;
        if (!dh) return;
        log(`[delta] ${label} dh=${dh}`);
        slot.height = newH;
        adjustOffsets(idx, dh);
    });
    ro.observe(slot.node);
    // @ts-ignore 保存以便 reset 时 disconnect
    slot.node._ro = ro;
}

/* ------------------------------------------------------------------
 * UI bootstrapping
 * ------------------------------------------------------------------*/
function setupTweetCatUI(menuList: HTMLElement, tpl: HTMLTemplateElement) {
    const menuItem = tpl.content.getElementById("tweetCatMenuItem")!.cloneNode(true) as HTMLElement;
    const area = tpl.content.getElementById("tweetCatArea")!.cloneNode(true) as HTMLElement;
    const main = document.querySelector("main[role='main']") as HTMLElement;
    const originalArea = main.firstChild as HTMLElement;

    const resetTimeline = () => {
        const tl = area.querySelector(".tweetTimeline") as HTMLElement;
        tl.querySelectorAll<HTMLElement>(".tweetNode").forEach((n) => {
            // @ts-ignore
            n._ro?.disconnect();
            // @ts-ignore
            n._watchRO?.disconnect();
        });
        tl.innerHTML = "";
        tl.style.removeProperty("height");
        slots = [];
        tl.removeEventListener("scroll", onScroll);
    };

    menuList.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => {
        area.style.display = "none";
        showOriginalTweetArea(originalArea);
        resetTimeline();
    }));

    menuItem.onclick = (ev) => {
        ev.preventDefault();
        hideOriginalTweetArea(originalArea);
        area.style.display = "block";
        history.replaceState({id: 123}, "", "/#/" + selfDefineUrl);

        timelineEl = area.querySelector(".tweetTimeline") as HTMLElement;
        resetTimeline();
        fillTweetAreaByTweets(timelineEl, tpl).catch(console.error);
    };

    menuList.insertBefore(menuItem, menuList.children[1]);
    main.insertBefore(area, originalArea);
}

export function appendTweetCatMenuItem() {
    observeSimple(
        document.body,
        () => document.querySelector("header nav[role='navigation']") as HTMLElement,
        (nav) => {
            if (nav.querySelector(".tweetCatMenuItem")) return true;
            parseContentHtml("html/content.html").then((tpl) => setupTweetCatUI(nav, tpl));
            return true;
        }
    );
}

export function switchToTweetCatTimeLine() {
    (document.getElementById("tweetCatMenuItem") as HTMLAnchorElement)?.click();
}

/* ------------------------------------------------------------------
 * 渲染 + 测量 + 初始化虚拟窗口（含动态补偿）
 * ------------------------------------------------------------------*/
async function fillTweetAreaByTweets(tl: HTMLElement, tpl: HTMLTemplateElement) {
    const {tweets} = await fetchTweets("1315345422123180033", 40);
    let offset = 0;

    for (const [idx, entry] of tweets.entries()) {
        const node = renderTweetHTML(entry, tpl);
        node.classList.add("tweetNode");
        node.setAttribute("data-tweet-id", String(entry.entryId));

        node.style.position = "static";       // flow 测量
        node.style.visibility = "hidden";

        watchSize(node, `tweet#${entry.entryId}`);
        tl.appendChild(node);
        await waitForStableHeight(node);

        const h = node.offsetHeight;
        const slot: Slot = {node, height: h, top: offset, attached: true};
        slots.push(slot);
        offset += h;

        // 立即挂 ResizeObserver（动态补偿）
        observeSlotHeight(slot, idx, `tweet#${entry.entryId}`);
    }

    // 绝对定位 & top
    for (const s of slots) {
        Object.assign(s.node.style, {
            position: "absolute",
            left: "0",
            top: s.top + "px",
            visibility: "visible",
        });
    }
    tl.style.height = offset + "px";

    timelineEl = tl;
    tl.addEventListener("scroll", onScroll, {passive: true});
    updateWindow();
}

/* ------------------------------------------------------------------
 * 虚拟滚动窗口
 * ------------------------------------------------------------------*/
function onScroll() {
    (window as any).requestIdleCallback
        ? (window as any).requestIdleCallback(updateWindow, {timeout: 100})
        : requestAnimationFrame(updateWindow);
}

function updateWindow() {
    if (!timelineEl) return;
    const viewTop = timelineEl.scrollTop;
    const viewBot = viewTop + timelineEl.clientHeight;
    const buf = ONE_SCREEN();
    const winTop = Math.max(0, viewTop - buf);
    const winBot = viewBot + buf;

    let start = binarySearch(winTop);
    let end = binarySearch(winBot);

    for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        if (i >= start && i <= end) {
            if (!s.attached) {
                timelineEl.appendChild(s.node);
                s.attached = true;
                s.node.style.top = s.top + "px"; // ensure fresh top
            }
        } else if (s.attached) {
            timelineEl.removeChild(s.node);
            s.attached = false;
        }
    }
    log(`[window] ${start} - ${end} (viewTop=${viewTop})`);
}

function binarySearch(y: number): number {
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
 * wait for two stable frames – 避免测量期抖动
 * ------------------------------------------------------------------*/
function waitForStableHeight(el: HTMLElement): Promise<void> {
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

/* ------------------------------------------------------------------
 * 预留接口
 * ------------------------------------------------------------------*/
async function loadCachedTweets() {
}

async function pullTweetsFromSrv() {
}
