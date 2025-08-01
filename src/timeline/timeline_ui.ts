import {observeSimple} from "../utils";
import {parseContentHtml} from "../content";
import {TweetManager} from "./div_cell_manager";
import {handleGrokMenuClick, isInTweetCatRoute, navigateToTweetCat} from "./route_helper";
import {logGuard} from "../debug_flags";

let manager: TweetManager | null = null;


function bindTweetCatMenu(menuItem: HTMLElement) {
    menuItem.addEventListener("click", async (ev) => {
        ev.preventDefault();
        if (isInTweetCatRoute()) {
            logGuard('reenter tweetCat menu');
            manager?.scrollToTop();
            return;
        }
        logGuard('menu click → routeToTweetCat');
        navigateToTweetCat();
    });
}

function hideGrokUIOnce() {
    if (document.getElementById('tc-hide-grok')) return;   // 已注入
    const css = '[data-testid="grokChatPromptContainer"],' +
        '[data-testid="grokChatRoot"]{display:none!important;}';
    const style = document.createElement('style');
    style.id = 'tc-hide-grok';
    style.textContent = css;
    document.head.appendChild(style);
}

let mounted = false;
function setupTweetCatUI(menuList: HTMLElement, tpl: HTMLTemplateElement) {
    const menuItem = tpl.content.getElementById('tweetCatMenuItem')!.cloneNode(true) as HTMLElement;
    const area     = tpl.content.getElementById('tweetCatArea')!.cloneNode(true)  as HTMLElement;
    area.style.display = 'none';

    const main          = document.querySelector("main[role='main']") as HTMLElement;
    const originalArea  = main.firstChild as HTMLElement;

    bindTweetCatMenu(menuItem);
    menuList.insertBefore(menuItem, menuList.children[1]);
    main.insertBefore(area, originalArea);

    /* ---------- 生命周期 ----------------------------- */
    window.addEventListener('tc-mount', () => {

        if (mounted) return;           // 已挂载则直接返回
        mounted = true;

        logGuard('<< tc-mount >>');
        hideGrokUIOnce();
        hideOriginalTweetArea(originalArea);

        area.style.display = 'block';
        const timelineEl = area.querySelector('.tweetTimeline') as HTMLElement;

        manager?.dispose();
        manager = new TweetManager(timelineEl, tpl);
    });

    window.addEventListener('tc-unmount', () => {
        if (!mounted) return;          // 未挂载则忽略
        mounted = false;

        logGuard('<< tc-unmount >>');
        area.style.display = 'none';
        showOriginalTweetArea(originalArea);
        manager?.dispose();
        manager = null;
    });

    /* ---------- 首屏直链补发 --------------------------- */
    const alreadyInTweetCat =
        location.pathname === '/i/grok' &&
        location.hash.startsWith('#/tweetCatTimeLine');

    if (alreadyInTweetCat) {
        logGuard('setup complete – dispatch synthetic tc-mount');
        window.dispatchEvent(new CustomEvent('tc-mount'));
    }

    bindGrokMenuHook();
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

function bindGrokMenuHook() {
    const grokLink = document.querySelector('a[href="/i/grok"]') as HTMLAnchorElement | null;
    if (!grokLink) return;

    grokLink.addEventListener('click', handleGrokMenuClick, { passive: false });
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
