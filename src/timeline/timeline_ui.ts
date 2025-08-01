import {deferByFrames, observeSimple} from "../utils";
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

let mounted = false;

function setupTweetCatUI(menuList: HTMLElement, tpl: HTMLTemplateElement) {

    snapshotGrokSvg();

    const menuItem = tpl.content.getElementById('tweetCatMenuItem')!.cloneNode(true) as HTMLElement;
    const area = tpl.content.getElementById('tweetCatArea')!.cloneNode(true) as HTMLElement;
    area.style.display = 'none';

    const main = document.querySelector("main[role='main']") as HTMLElement;
    const originalArea = main.firstChild as HTMLElement;

    bindTweetCatMenu(menuItem);
    menuList.insertBefore(menuItem, menuList.children[1]);
    main.insertBefore(area, originalArea);

    /* ---------- 生命周期 ----------------------------- */
    window.addEventListener('tc-mount', () => {

        if (mounted) return;           // 已挂载则直接返回
        mounted = true;

        logGuard('<< tc-mount >>');
        ensureGrokNormalIcon();
        hideOriginalTweetArea(originalArea);
        deferByFrames(() => {
            demoteGrokFont()
        }, 2)

        area.style.display = 'block';
        const timelineEl = area.querySelector('.tweetTimeline') as HTMLElement;

        manager?.dispose();
        manager = new TweetManager(timelineEl, tpl);
    });

    window.addEventListener('tc-unmount', () => {

        if (!mounted) return;          // 未挂载则忽略
        mounted = false;

        logGuard('<< tc-unmount >>');

        stopWatchingGrok();

        deferByFrames(() => {
            swapSvgToSelected();
            restoreGrokFont();
            snapshotGrokSvg();
        }, 2)

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

    grokLink.addEventListener('click', handleGrokMenuClick, {passive: false});
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


let grokSvgNormal = '';     // 未选中（细线）版
let grokSvgSelected = '';    // 选中（粗线）版

function snapshotGrokSvg() {
    const link = document.querySelector('a[href="/i/grok"]') as HTMLElement | null;
    const svg = link?.querySelector('svg') as SVGSVGElement | null;

    if (!link || !svg) return;                         // ★ 提前返回，避免写空缓存

    const viewBox = svg.getAttribute('viewBox') ?? '';
    if (viewBox === '0 0 33 32') {                     // 细线 ⇒ 未选中
        grokSvgNormal = svg.outerHTML;
    } else if (viewBox === '0 0 42 42') {              // 粗线 ⇒ 选中
        grokSvgSelected = svg.outerHTML;
    }
}

/* 把指定 attrs 从 src 复制到 dst（若存在） */
function syncAttrs(
    src: Element,
    dst: Element,
    attrs: string[] = ['d', 'clip-rule', 'fill-rule']
) {
    attrs.forEach(name => {
        const val = src.getAttribute(name);
        if (val !== null) dst.setAttribute(name, val);
    });
}


let grokMo: MutationObserver | null = null;

function swapSvgToNormal() {
    const link = document.querySelector('a[href="/i/grok"]');
    const svg = link?.querySelector('svg');
    if (!svg) return;

    /* ★ 若当前是粗线，且未缓存过，先缓存粗图 */
    if (svg.getAttribute('viewBox') === '0 0 42 42' && !grokSvgSelected) {
        grokSvgSelected = svg.outerHTML;
    }

    /* 已是细线则返回 */
    if (svg.getAttribute('viewBox') === '0 0 33 32') return;
    if (!grokSvgNormal) return;                       // 细图仍未拿到 → 跳过

    const tpl = document.createElement('template');
    tpl.innerHTML = grokSvgNormal.trim();
    const fineSvg = tpl.content.querySelector('svg')!;

    /* ① viewBox */
    svg.setAttribute('viewBox', fineSvg.getAttribute('viewBox')!);
    /* ② path d + 规则属性 */
    const curPath = svg.querySelector('path')!;
    const finePath = fineSvg.querySelector('path')!;
    syncAttrs(finePath, curPath, ['d', 'clip-rule', 'fill-rule']);
}

function swapSvgToSelected() {
    if (!grokSvgSelected) return;                      // 粗图没缓存 → 跳过
    const link = document.querySelector('a[href="/i/grok"]');
    const svg = link?.querySelector('svg');
    if (!svg) return;

    if (svg.getAttribute('viewBox') === '0 0 42 42') return; // 已是粗线

    const tpl = document.createElement('template');
    tpl.innerHTML = grokSvgSelected.trim();
    const selSvg = tpl.content.querySelector('svg')!;

    svg.setAttribute('viewBox', selSvg.getAttribute('viewBox')!);

    const curPath = svg.querySelector('path')!;
    const selPath = selSvg.querySelector('path')!;
    syncAttrs(selPath, curPath, ['d', 'clip-rule', 'fill-rule']);
}

/* 在 tc-mount 时调用：加两帧延迟 + MutationObserver */
function ensureGrokNormalIcon() {
    // 两帧后执行，避开 React 下一轮 commit
    requestAnimationFrame(() => {
        requestAnimationFrame(swapSvgToNormal);
    });

    // 再监听 Grok 按钮子树，如被 React 覆盖再兜回来
    if (grokMo) grokMo.disconnect();
    const link = document.querySelector('a[href="/i/grok"]');
    if (!link) return;
    grokMo = new MutationObserver(swapSvgToNormal);
    grokMo.observe(link, {childList: true, subtree: true, attributes: true});
}

/* 在 tc-unmount 时调用 */
function stopWatchingGrok() {
    grokMo?.disconnect();
    grokMo = null;
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
