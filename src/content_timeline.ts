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

function watchSize(el: HTMLElement, label: string) {
    const ro = new ResizeObserver((entries) => {
        for (const e of entries) {
            const {width, height} = e.contentRect;
            log(`[size] ${label} -> ${width}×${height}px`);
        }
    });
    ro.observe(el);
    // @ts-ignore store for later disconnect
    el._ro = ro;
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
 * 虚拟滚动相关数据结构
 * ------------------------------------------------------------------*/
interface Slot {
    node: HTMLElement;
    height: number;
    top: number;
    attached: boolean;
}

let slots: Slot[] = [];
let timelineEl: HTMLElement; // 当前 tweetTimeline 引用

const ONE_SCREEN = () => timelineEl?.clientHeight ?? 800; // 备用

/* ------------------------------------------------------------------
 * UI bootstrapping
 * ------------------------------------------------------------------*/
function setupTweetCatUI(menuList: HTMLElement, tpl: HTMLTemplateElement) {
    const menuItem = tpl.content.getElementById("tweetCatMenuItem")!.cloneNode(true) as HTMLElement;
    const area = tpl.content.getElementById("tweetCatArea")!.cloneNode(true) as HTMLElement;

    const main = document.querySelector("main[role='main']") as HTMLElement;
    const originalArea = main.firstChild as HTMLElement;

    // 点击其他 Tab
    menuList.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => {
        area.style.display = "none";
        showOriginalTweetArea(originalArea);
        resetTimeline(area);
    }));

    // 点击 TweetCat Tab
    menuItem.onclick = (ev) => {
        ev.preventDefault();
        hideOriginalTweetArea(originalArea);
        area.style.display = "block";
        history.replaceState({id: 123}, "", "/#/" + selfDefineUrl);

        timelineEl = area.querySelector(".tweetTimeline") as HTMLElement;
        resetTimeline(area);
        fillTweetAreaByTweets(timelineEl, tpl).catch(console.error);
    };

    menuList.insertBefore(menuItem, menuList.children[1]);
    main.insertBefore(area, originalArea);
}

function resetTimeline(area: HTMLElement) {
    const tl = area.querySelector(".tweetTimeline") as HTMLElement;
    tl.querySelectorAll<HTMLElement>(".tweetNode").forEach((n) => {
        // @ts-ignore
        n._ro?.disconnect();
    });
    tl.innerHTML = "";
    tl.style.removeProperty("height");
    slots = [];
    tl.removeEventListener("scroll", onScroll);
}

export function appendTweetCatMenuItem() {
    observeSimple(document.body, () => document.querySelector("header nav[role='navigation']") as HTMLElement, (nav) => {
        if (nav.querySelector(".tweetCatMenuItem")) return true;
        parseContentHtml("html/content.html").then((tpl) => setupTweetCatUI(nav, tpl));
        return true;
    });
}

export function switchToTweetCatTimeLine() {
    (document.getElementById("tweetCatMenuItem") as HTMLAnchorElement)?.click();
}

/* ------------------------------------------------------------------
 * 渲染 + 测量 + 初始化虚拟窗口
 * ------------------------------------------------------------------*/
async function fillTweetAreaByTweets(tl: HTMLElement, tpl: HTMLTemplateElement) {
    const {tweets} = await fetchTweets("1315345422123180033", 40);

    let offset = 0;
    for (const entry of tweets) {
        const node = renderTweetHTML(entry, tpl);
        node.classList.add("tweetNode");
        node.style.position = "static"; // flow 测量

        watchSize(node, `tweet#${entry.entryId}`);
        tl.appendChild(node);
        await waitForStableHeight(node);

        const h = node.offsetHeight;
        slots.push({node, height: h, top: offset, attached: true});
        offset += h;
    }

    // 转绝对定位 & 设置 top
    for (const s of slots) {
        s.node.style.position = "absolute";
        s.node.style.left = "0";
        s.node.style.top = s.top + "px";
    }
    tl.style.height = offset + "px";

    // 初始化滚动窗口
    timelineEl = tl;
    tl.addEventListener("scroll", onScroll, {passive: true});
    updateWindow();
}

/* ------------------------------------------------------------------
 * 虚拟滚动窗口
 * ------------------------------------------------------------------*/
function onScroll() {
    // 采用 requestIdleCallback，fallback 到 RAF
    (window as any).requestIdleCallback ? (window as any).requestIdleCallback(updateWindow, {timeout: 100}) : requestAnimationFrame(updateWindow);
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
            }
        } else if (s.attached) {
            timelineEl.removeChild(s.node);
            s.attached = false;
        }
    }

    log(`[window] ${start} - ${end} (viewTop=${viewTop})`);
}

function binarySearch(y: number): number {
    let l = 0, r = slots.length - 1, m = 0;
    while (l <= r) {
        m = (l + r) >> 1;
        const s = slots[m];
        if (s.top + s.height < y) l = m + 1;
        else r = m - 1;
    }
    return l;
}

/* ------------------------------------------------------------------
 * 工具：等待高度稳定两帧
 * ------------------------------------------------------------------*/
function waitForStableHeight(el: HTMLElement): Promise<void> {
    return new Promise((res) => {
        let last = el.offsetHeight, stable = 0;
        const chk = () => {
            const h = el.offsetHeight;
            if (h === last) stable++; else {
                stable = 0;
                last = h;
            }
            if (stable >= 2) res(); else requestAnimationFrame(chk);
        };
        requestAnimationFrame(chk);
    });
}

/* ------------------------------------------------------------------
 * 预留接口
 * ------------------------------------------------------------------*/
async function loadCachedTweets() {
}

async function pullTweetsFromSrv() {
}
