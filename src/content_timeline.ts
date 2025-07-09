import {observeSimple} from "./utils";
import {parseContentHtml} from "./content";
import {fetchTweets} from "./tweet_api";
import {renderTweetHTML} from "./tweet_render";

/**
 * Route used when我们切换到自定义时间线时，写入到 location.hash
 */
const selfDefineUrl = "tweetCatTimeLine";

/* ------------------------------------------------------------------
 * Debug  &  ResizeObserver probe
 * ------------------------------------------------------------------*/

// DEBUG 永久开启，方便排查
const DEBUG = true;

function log(...args: unknown[]) {
    if (DEBUG) console.debug(...args);
}

/**
 * 给元素挂一个 ResizeObserver ，尺寸一变就打印。
 * 同时把 observer 挂到 el._ro ，便于后续 disconnect。
 */
function watchSize(el: HTMLElement, label: string) {
    const ro = new ResizeObserver((entries) => {
        for (const e of entries) {
            const {width, height} = e.contentRect;
            log(`[size] ${label} -> ${width}×${height}px`);
        }
    });
    ro.observe(el);
    // @ts-ignore – runtime 注入
    el._ro = ro;
}

/* ------------------------------------------------------------------
 * DOM util – 隐藏 / 显示原生 TimeLine
 * ------------------------------------------------------------------*/
function hideOriginalTweetArea(originalTweetArea: HTMLElement) {
    originalTweetArea.style.position = "absolute";
    originalTweetArea.style.top = "-9999px";
    originalTweetArea.style.left = "-9999px";
    originalTweetArea.style.width = "1px";
    originalTweetArea.style.height = "1px";
    originalTweetArea.style.overflow = "hidden";
    originalTweetArea.style.pointerEvents = "none";
    originalTweetArea.style.visibility = "hidden";
}

function showOriginalTweetArea(originalTweetArea: HTMLElement) {
    originalTweetArea.style.position = "";
    originalTweetArea.style.top = "";
    originalTweetArea.style.left = "";
    originalTweetArea.style.width = "";
    originalTweetArea.style.height = "";
    originalTweetArea.style.overflow = "";
    originalTweetArea.style.pointerEvents = "";
    originalTweetArea.style.visibility = "";
}

/* ------------------------------------------------------------------
 * UI bootstrapping
 * ------------------------------------------------------------------*/
function setupTweetCatUI(menuList: HTMLElement, contentTemplate: HTMLTemplateElement) {
    // 克隆模板里的 menu 按钮 / 时间线容器
    const tweetCatMenuItem = contentTemplate.content
        .getElementById("tweetCatMenuItem")!
        .cloneNode(true) as HTMLElement;
    const tweetCatArea = contentTemplate.content
        .getElementById("tweetCatArea")!
        .cloneNode(true) as HTMLElement;

    const mainArea = document.querySelector("main[role='main']") as HTMLElement;
    const originalTweetArea = mainArea.firstChild as HTMLElement;

    // ──────────────────────────────────────────────────────────────────
    // 点击其他 nav tab：销毁我们的时间线并恢复原生
    // ──────────────────────────────────────────────────────────────────
    menuList.querySelectorAll("a").forEach((elm) => {
        elm.addEventListener("click", () => {
            tweetCatArea.style.display = "none";
            showOriginalTweetArea(originalTweetArea);

            const tweetCatTimeLine = tweetCatArea.querySelector(
                ".tweetTimeline"
            ) as HTMLElement;

            // 断开旧 ResizeObservers，避免内存泄漏
            tweetCatTimeLine.querySelectorAll<HTMLElement>(".tweetNode").forEach((n) => {
                // @ts-ignore
                n._ro?.disconnect();
            });

            tweetCatTimeLine.innerHTML = "";
            tweetCatTimeLine.style.removeProperty("height");
        });
    });

    // ──────────────────────────────────────────────────────────────────
    // 点击 TweetCat Tab：进入自定义时间线
    // ──────────────────────────────────────────────────────────────────
    tweetCatMenuItem.onclick = (ev) => {
        ev.preventDefault();

        hideOriginalTweetArea(originalTweetArea);
        tweetCatArea.style.display = "block";
        history.replaceState({id: 123}, "", "/#/" + selfDefineUrl);

        const tweetCatTimeLine = tweetCatArea.querySelector(
            ".tweetTimeline"
        ) as HTMLElement;

        // 如果用户反复点击本 tab，需清理旧内容再重建
        tweetCatTimeLine.querySelectorAll<HTMLElement>(".tweetNode").forEach((n) => {
            // @ts-ignore
            n._ro?.disconnect();
        });
        tweetCatTimeLine.innerHTML = "";
        tweetCatTimeLine.style.removeProperty("height");

        fillTweetAreaByTweets(tweetCatTimeLine, contentTemplate).catch(console.error);
    };

    // 把按钮插入导航，把自定义 area 插入 main
    menuList.insertBefore(tweetCatMenuItem, menuList.children[1]);
    mainArea.insertBefore(tweetCatArea, originalTweetArea);
}

/* ------------------------------------------------------------------
 * 启动入口：等导航渲染完之后插入按钮
 * ------------------------------------------------------------------*/
export function appendTweetCatMenuItem() {
    observeSimple(
        document.body,
        () => document.querySelector("header nav[role='navigation']") as HTMLElement,
        (menuList) => {
            if (menuList.querySelector(".tweetCatMenuItem")) {
                return true; // 已插入
            }
            parseContentHtml("html/content.html").then((contentTemplate) => {
                setupTweetCatUI(menuList, contentTemplate);
            });
            return true;
        }
    );
}

export function switchToTweetCatTimeLine() {
    const tweetCatMenuItem = document.getElementById("tweetCatMenuItem") as HTMLAnchorElement;
    tweetCatMenuItem?.click();
}

/* ------------------------------------------------------------------
 * 两阶段：测量(静态) → 绝对定位
 * ------------------------------------------------------------------*/
async function fillTweetAreaByTweets(
    tweetCatArea: HTMLElement,
    contentTemplate: HTMLTemplateElement
) {
    const {tweets} = await fetchTweets("1315345422123180033", 20);
    const slots: { node: HTMLElement; height: number }[] = [];

    // 1️⃣ 渲染到普通流，测量自然高度
    for (const entry of tweets) {
        const node = renderTweetHTML(entry, contentTemplate);
        node.classList.add("tweetNode");

        watchSize(node, `tweet#${entry.entryId}`);

        tweetCatArea.appendChild(node);
        await waitForStableHeight(node);

        slots.push({node, height: node.offsetHeight});
    }

    // 2️⃣ 绝对定位并累加 top
    let offset = 0;
    for (const {node, height} of slots) {
        node.style.position = "absolute";
        node.style.left = "0";
        node.style.top = `${offset}px`;
        node.style.transform = "";
        offset += height;
    }

    tweetCatArea.style.height = `${offset}px`;
}

/* ------------------------------------------------------------------
 * 等待节点高度稳定 2 帧
 * ------------------------------------------------------------------*/
function waitForStableHeight(el: HTMLElement): Promise<void> {
    return new Promise((resolve) => {
        let last = el.offsetHeight;
        let stable = 0;
        const check = () => {
            const h = el.offsetHeight;
            if (h === last) stable++; else {
                stable = 0;
                last = h;
            }
            if (stable >= 2) resolve(); else requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
    });
}

/* ------------------------------------------------------------------
 * 预留
 * ------------------------------------------------------------------*/
async function loadCachedTweets() {
}

async function pullTweetsFromSrv() {
}