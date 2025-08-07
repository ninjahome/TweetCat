import {deferByFrames, observeSimple} from "../common/utils";
import {parseContentHtml} from "../content/content";
import {TweetManager} from "./div_cell_manager";
import {
    handleGrokMenuClick,
    isInTweetCatRoute,
    navigateToTweetCat,
    swapSvgToNormal,
    swapSvgToSelected
} from "./route_helper";
import {logGuard} from "../common/debug_flags";
import {setSelectedCategory} from "../content/content_filter";

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

let mounted = false;

export function setupTweetCatUI(menuList: HTMLElement, tpl: HTMLTemplateElement, main: HTMLElement) {
    const menuItem = tpl.content.getElementById('tweetCatMenuItem')!.cloneNode(true) as HTMLElement;
    const area = tpl.content.getElementById('tweetCatArea')!.cloneNode(true) as HTMLElement;
    area.style.display = 'none';

    const originalArea = main.firstChild as HTMLElement;

    bindTweetCatMenu(menuItem);
    menuList.insertBefore(menuItem, menuList.children[1]);
    main.insertBefore(area, originalArea);

    /* ---------- 生命周期 ----------------------------- */
    window.addEventListener('tc-mount', () => {
        tcMount(area, originalArea, tpl);
        menuItem.classList.add("tc-selected")
    });

    window.addEventListener('tc-unmount', () => {
        menuItem.classList.remove("tc-selected")
        tcUnmount(area, originalArea);
    });

    /* ---------- 首屏直链补发 --------------------------- */
    const alreadyInTweetCat =
        location.pathname === '/i/grok' &&
        location.hash.startsWith('#/tweetCatTimeLine');

    if (alreadyInTweetCat) {
        logGuard('setup complete – dispatch synthetic tc-mount');
        window.dispatchEvent(new CustomEvent('tc-mount'));
    }

    const grokLink = document.querySelector('a[href="/i/grok"]') as HTMLAnchorElement | null;
    grokLink?.addEventListener('click', handleGrokMenuClick, {passive: false});
}

function stopWatchingGrok() {
    grokMo?.disconnect();
    grokMo = null;
}

function tcMount(area: HTMLElement, originalArea: HTMLElement, tpl: HTMLTemplateElement) {
    if (mounted) return;           // 已挂载则直接返回
    mounted = true;

    logGuard('<< tc-mount >>');
    ensureGrokNormalIcon();
    hideOriginalTweetArea(originalArea);
    deferByFrames(demoteGrokFont, 2);

    area.style.display = 'block';
    const timelineEl = area.querySelector('.tweetTimeline') as HTMLElement;

    manager?.dispose();
    manager = new TweetManager(timelineEl, tpl);
    setSelectedCategory(-1)
}

export async function switchCategory(catID:number|null){
    manager?.dispose();
    manager?.switchCategory(catID);
}

function tcUnmount(area: HTMLElement, originalArea: HTMLElement) {
    if (!mounted) return;          // 未挂载则忽略
    mounted = false;

    logGuard('<< tc-unmount >>');
    stopWatchingGrok();

    deferByFrames(() => {
        const isNowInGrok = location.pathname === '/i/grok' &&
            !location.hash.startsWith('#/tweetCatTimeLine');
        if (isNowInGrok) {
            swapSvgToSelected();
            restoreGrokFont();
        } else {
            swapSvgToNormal();   // 保险再细化一次
            demoteGrokFont();
        }
    }, 2)

    area.style.display = 'none';
    showOriginalTweetArea(originalArea);
    manager?.dispose();
    manager = null;
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


let grokMo: MutationObserver | null = null;

/* 在 tc-mount 时调用：加两帧延迟 + MutationObserver */
function ensureGrokNormalIcon() {
    deferByFrames(swapSvgToNormal, 2)
    // 再监听 Grok 按钮子树，如被 React 覆盖再兜回来
    if (grokMo) grokMo.disconnect();
    const link = document.querySelector('a[href="/i/grok"]');
    if (!link) return;
    grokMo = new MutationObserver(swapSvgToNormal);
    grokMo.observe(link, {childList: true, subtree: true, attributes: true});
}


/* ------------------------------------------------------------
 * Grok 字体细体 / 粗体切换工具
 * ------------------------------------------------------------ */
const GROK_LINK_SELECTOR = 'a[href="/i/grok"]';
const GROK_TEXT_CONTAINER_SEL = 'div[dir="ltr"]';
const GROK_BOLD_CLASS = 'r-b88u0q';
const NORMAL_COLOR = 'rgb(15,20,25)';
const NORMAL_WEIGHT = '400';

/** 进入 TweetCat 时：把 Grok 文本降为普通黑体 */
export function demoteGrokFont(): void {
    const link = document.querySelector(GROK_LINK_SELECTOR) as HTMLElement | null;
    const textDiv = link?.querySelector(GROK_TEXT_CONTAINER_SEL) as HTMLElement | null;
    if (!textDiv) return;

    /* 1. 去掉 Twitter 的粗体类 */
    textDiv.classList.remove(GROK_BOLD_CLASS);

    /* 2. 行内样式写死普通字重 + 颜色（带 !important） */
    textDiv.style.setProperty('font-weight', NORMAL_WEIGHT, 'important');
    textDiv.style.setProperty('color', NORMAL_COLOR, 'important');

    /* 3. 内部 <span> 双保险 */
    textDiv.querySelectorAll('span').forEach(span => {
        (span as HTMLElement).style.setProperty('font-weight', NORMAL_WEIGHT, 'important');
        (span as HTMLElement).style.setProperty('color', NORMAL_COLOR, 'important');
    });
}

/** 退出 TweetCat 时：恢复 Grok 的选中蓝色粗体 */
export function restoreGrokFont(): void {
    const link = document.querySelector(GROK_LINK_SELECTOR) as HTMLElement | null;
    const textDiv = link?.querySelector(GROK_TEXT_CONTAINER_SEL) as HTMLElement | null;
    if (!textDiv) return;

    /* 1. 加回粗体类（若已存在则忽略） */
    textDiv.classList.add(GROK_BOLD_CLASS);

    /* 2. 去掉我们写的行内覆盖，让 Twitter 默认样式接管 */
    textDiv.style.removeProperty('font-weight');
    textDiv.style.removeProperty('color');

    /* 3. 同步清掉 <span> 覆盖 */
    textDiv.querySelectorAll('span').forEach(span => {
        (span as HTMLElement).style.removeProperty('font-weight');
        (span as HTMLElement).style.removeProperty('color');
    });
}