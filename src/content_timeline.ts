import {observeSimple} from "./utils";
import {parseContentHtml} from "./content";
import {fetchTweets} from "./tweet_api";
import {renderTweetHTML} from "./tweet_render";
import {binarySearch, hideOriginalTweetArea, showOriginalTweetArea, Slot, waitForStableHeight} from "./timeline_util";

/**
 * Route used when我们切换到自定义时间线时，写入到 location.hash
 */
const selfDefineUrl = "tweetCatTimeLine";

/* ------------------------------------------------------------------
 * Debug & helpers
 * ------------------------------------------------------------------*/
const DEBUG = true;
const log = (...args: unknown[]) => DEBUG && console.debug(...args);

let slots: Slot[] = [];
let timelineEl: HTMLElement; // tweetTimeline ref

const ONE_SCREEN = () => timelineEl?.clientHeight ?? 800; // fall-back

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
 * UI bootstrapping helpers
 * ------------------------------------------------------------------*/
function createUIElements(tpl: HTMLTemplateElement) {
    const menuItem = tpl.content.getElementById("tweetCatMenuItem")!
        .cloneNode(true) as HTMLElement;
    const area = tpl.content.getElementById("tweetCatArea")!
        .cloneNode(true) as HTMLElement;
    return {menuItem, area};
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

function bindReturnToOriginal(
    menuList: HTMLElement,
    area: HTMLElement,
    originalArea: HTMLElement
) {
    menuList.querySelectorAll("a").forEach((a) => {
        a.addEventListener("click", () => {
            area.style.display = "none";
            showOriginalTweetArea(originalArea);
            resetTimeline(area);
        });
    });
}

function bindCustomMenu(
    menuItem: HTMLElement,
    area: HTMLElement,
    originalArea: HTMLElement,
    tpl: HTMLTemplateElement
) {
    menuItem.addEventListener("click", (ev) => {
        ev.preventDefault();
        hideOriginalTweetArea(originalArea);
        area.style.display = "block";
        history.replaceState({id: 123}, "", "/#/" + selfDefineUrl);

        timelineEl = area.querySelector(".tweetTimeline") as HTMLElement;
        resetTimeline(area);
        fillTweetAreaByTweets(timelineEl, tpl).catch(console.error);
    });
}

/* ------------------------------------------------------------------
 * UI bootstrapping
 * ------------------------------------------------------------------*/
function setupTweetCatUI(
    menuList: HTMLElement,
    tpl: HTMLTemplateElement
) {
    const {menuItem, area} = createUIElements(tpl);
    const main = document.querySelector("main[role='main']") as HTMLElement;
    const originalArea = main.firstChild as HTMLElement;

    bindReturnToOriginal(menuList, area, originalArea);
    bindCustomMenu(menuItem, area, originalArea, tpl);

    menuList.insertBefore(menuItem, menuList.children[1]);
    main.insertBefore(area, originalArea);
}

export function appendTweetCatMenuItem() {
    observeSimple(
        document.body,
        () =>
            document.querySelector("header nav[role='navigation']") as HTMLElement,
        (nav) => {
            if (nav.querySelector(".tweetCatMenuItem")) return true;
            parseContentHtml("html/content.html").then((tpl) =>
                setupTweetCatUI(nav, tpl)
            );
            return true;
        }
    );
}

export function switchToTweetCatTimeLine() {
    (
        document.getElementById("tweetCatMenuItem") as HTMLAnchorElement
    )?.click();
}

/* ------------------------------------------------------------------
 * 渲染 + 测量 + 初始化虚拟窗口（含动态补偿）
 * ------------------------------------------------------------------*/
async function fillTweetAreaByTweets(
    tl: HTMLElement,
    tpl: HTMLTemplateElement
) {
    const {tweets} = await fetchTweets("1315345422123180033", 40);
    let offset = 0;

    for (const [idx, entry] of tweets.entries()) {
        const node = renderTweetHTML(entry, tpl);
        node.classList.add("tweetNode");
        node.setAttribute("data-tweet-id", String(entry.entryId));

        node.style.position = "static"; // flow 测量
        node.style.visibility = "hidden";

        tl.appendChild(node);
        await waitForStableHeight(node);

        const h = node.offsetHeight;
        const slot: Slot = {
            node,
            height: h,
            top: offset,
            attached: true,
        };
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

    let start = binarySearch(winTop, slots);
    let end = binarySearch(winBot, slots);

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
