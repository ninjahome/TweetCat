import {deferByFrames} from "../common/utils";
import {TweetManager} from "../timeline/div_cell_manager";
import {
    handleGrokMenuClick,
    isInTweetCatRoute,
    navigateToTweetCat, setTweetCatFlag,
    swapSvgToNormal,
    swapSvgToSelected
} from "../timeline/route_helper";
import {logGuard} from "../common/debug_flags";

import {resetNewestTweet, setSelectedCategory} from "./tweetcat_web3_area";
import {getSessCatID} from "../timeline/tweet_pager";
import {MsgType} from "../common/consts";
import {t} from "../common/i18n";

let manager: TweetManager | null = null;

function bindTweetCatMenu(menuItem: HTMLElement, area: HTMLElement, originalArea: HTMLElement, tpl: HTMLTemplateElement) {
    menuItem.addEventListener("click", async (ev) => {
        ev.preventDefault();
        if (isInTweetCatRoute()) {
            logGuard('reenter tweetCat menu');
            tcMount(area, originalArea, tpl, true);
            resetNewestTweet();
            return;
        }
        logGuard('menu click → routeToTweetCat');
        navigateToTweetCat();
    });
}

function prepareElementOfWeb3(tpl: HTMLTemplateElement){
    const toastForFavorite = tpl.content.getElementById('tweet-toast')!.cloneNode(true) as HTMLElement;
    document.body.appendChild(toastForFavorite);
    toastForFavorite.style.display = 'none';

    let imageScaleDiv = tpl.content.getElementById("tcqPhotoLightbox")!.cloneNode(true) as HTMLElement;
    document.body.appendChild(imageScaleDiv);

    let dialogDiv = tpl.content.getElementById("tw-dialog-overlay")!.cloneNode(true) as HTMLElement;
    document.body.appendChild(dialogDiv);
    (dialogDiv.querySelector(".tw-dialog-btn-confirm") as HTMLElement).innerText = t('confirm');
    dialogDiv.style.setProperty('display', 'none', 'important');
    const dialogClose = dialogDiv.querySelector(".tw-dialog-close") as HTMLButtonElement;
    dialogClose.addEventListener('click', () => {
        dialogDiv.style.setProperty('display', 'none', 'important');
    })

    let waitingOverlay = tpl.content.getElementById("global-wait-overlay")!.cloneNode(true) as HTMLElement;
    (waitingOverlay.querySelector(".wait-title") as HTMLElement).innerText = t('wait_title');
    document.body.appendChild(waitingOverlay);

    let aiTrend = tpl.content.getElementById("ai-trend-result")!.cloneNode(true) as HTMLElement;
    aiTrend.style.display='none';
    (aiTrend.querySelector(".topic-factor-title") as HTMLElement).innerText = t('topic_factor_title');
    (aiTrend.querySelector(".topic-participation-title") as HTMLElement).innerText = t('topic_participation_title');

    document.body.appendChild(aiTrend);
}

let mounted = false;

export function setupTweetCatMenuAndTimeline(menuList: HTMLElement, tpl: HTMLTemplateElement, main: HTMLElement) {

    prepareElementOfWeb3(tpl);

    const menuItem = tpl.content.getElementById('tweetCatMenuItem')!.cloneNode(true) as HTMLElement;
    const area = tpl.content.getElementById('tweetCatArea')!.cloneNode(true) as HTMLElement;
    area.style.display = 'none';
    area.querySelector<HTMLElement>(".tweet-title")!.innerText = t('web3_coming');

    const originalArea = main.firstChild as HTMLElement;

    const homeBtn = menuList.children[0];
    homeBtn.addEventListener('click', () => {
        setTweetCatFlag(false);
    })

    bindTweetCatMenu(menuItem, area, originalArea, tpl);
    menuList.insertBefore(menuItem, menuList.children[1]);
    main.insertBefore(area, originalArea);

    window.addEventListener(MsgType.RouterTCMount, () => {
        tcMount(area, originalArea, tpl);
        menuItem.classList.add("tc-selected")
    });

    window.addEventListener(MsgType.RouterTCBeforeNav, () => {
        if (!isInTweetCatRoute()) return;
        manager?.scroller?.pause?.();
    });

    window.addEventListener(MsgType.RouterTcUnmount, () => {
        menuItem.classList.remove("tc-selected")
        tcUnmount(area, originalArea);
    });

    const alreadyInTweetCat =
        location.pathname === '/i/grok' &&
        location.hash.startsWith('#/tweetCatTimeLine');

    if (alreadyInTweetCat) {
        logGuard('setup complete – dispatch synthetic tc-mount');
        tcMount(area, originalArea, tpl, true);
        menuItem.classList.add("tc-selected")
    }

    const grokLink = document.querySelector('a[href="/i/grok"]') as HTMLAnchorElement | null;
    grokLink?.addEventListener('click', handleGrokMenuClick, {passive: false});
}

function tcMount(area: HTMLElement, originalArea: HTMLElement, tpl: HTMLTemplateElement, force = false) {
    if (mounted && !force) return;   // 已挂载且非强制 → 直接返回
    mounted = true;

    hideOriginalTweetArea(originalArea);
    showTweetCatArea(area);
    logGuard('<< tc-tcMount >>');

    deferByFrames(() => {
        swapSvgToNormal();
        demoteGrokFont();
    }, 2);

    if (force && manager) {
        manager.dispose?.();
        manager = null;
        logGuard('[TC.KEEPALIVE] force remount – disposed old manager');
    }

    if (manager) {
        logGuard('[TC.KEEPALIVE] show (reuse instance)');
        manager.scroller?.resume();
        return;
    }

    const timelineEl = area.querySelector('.tweetTimeline') as HTMLElement;
    manager = new TweetManager(timelineEl, tpl);
    logGuard('[TC.KEEPALIVE] first mount (new instance)');

    setSelectedCategory(getSessCatID())
}

export async function switchCategory(catID: number) {
    manager?.switchCategory(catID);
}

function tcUnmount(area: HTMLElement, originalArea: HTMLElement) {
    if (!mounted) return;          // 未挂载则忽略
    mounted = false;

    manager?.scroller?.pause?.();
    hideTweetCatArea(area);

    logGuard('<< tc-unmount >>');
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

    showOriginalTweetArea(originalArea);
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


// 新增：隐藏/显示 tweetCat 区域（不会把高度变成 0）
function hideTweetCatArea(el: HTMLElement) {
    Object.assign(el.style, {
        position: 'fixed',
        top: '0',
        left: '-10000px',  // 挪出视口
        width: '100%',     // 保持原宽度，避免布局突变
        visibility: 'hidden',
        pointerEvents: 'none',
    } as CSSStyleDeclaration);
}

function showTweetCatArea(el: HTMLElement) {
    if (el.style.display !== 'block') el.style.display = 'block';
    Object.assign(el.style, {
        position: '',
        top: '',
        left: '',
        width: '',
        visibility: '',
        pointerEvents: '',
    } as CSSStyleDeclaration);
}


/* ------------------------------------------------------------
* Grok 字体细体 / 粗体切换工具
* ------------------------------------------------------------ */
const GROK_LINK_SELECTOR = 'a[href="/i/grok"]';
const GROK_TEXT_CONTAINER_SEL = 'div[dir="ltr"]';
const GROK_BOLD_CLASS = 'r-b88u0q';
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

    /* 3. 内部 <span> 双保险 */
    textDiv.querySelectorAll('span').forEach(span => {
        (span as HTMLElement).style.setProperty('font-weight', NORMAL_WEIGHT, 'important');
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