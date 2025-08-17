import browser from "webextension-polyfill";
import {logGuard, logRoute} from "../common/debug_flags";

let inited = false;
let currentInTC: boolean | null = null;      // 记录上一次状态
const PATH = '/i/grok';
const HASH = '#/tweetCatTimeLine';
const FULL = `${PATH}${HASH}`;
initRouteGuard();

let __tc_fromTweetCat = false;
export function setTweetCatFlag(flag: boolean) {
    logRoute('set tweet  flag to →', flag);
    __tc_fromTweetCat = flag;
}

export function getTweetCatFlag():boolean{
    return __tc_fromTweetCat;
}

export function isInTweetCatRoute(): boolean {
    return location.pathname === PATH && location.hash.startsWith(HASH);
}

function injectHistoryPatchIntoPage() {
    if (document.getElementById('tc-history-patch')) return;

    const url = browser.runtime.getURL('js/injection.js');
    const s = document.createElement('script');
    s.id = 'tc-history-patch';
    s.src = url;
    s.onload = () => s.remove();      // 注入后自删
    document.documentElement.appendChild(s);
}

function pushOrReplace(path: string) {
    // 是否已经为 TweetCat 写过一次历史（放到 history.state 里做标记，避免 TDZ/循环依赖）
    const hasEntry = !!(history.state && (history.state as any).__tcEntered);

    // 首次进入且会话历史只有 1 条时，用 replace；否则 push
    const method: 'pushState' | 'replaceState' =
        (!hasEntry && history.length <= 1) ? 'replaceState' : 'pushState';

    // 合并现有 state，写入我们的标记
    const nextState = { ...(history.state || {}), __tcEntered: true };

    history[method](nextState, '', path);
    logRoute(`${method} →`, path);
}

export function routeToTweetCat() {
    pushOrReplace(FULL);          // ← 统一入口
    handleLocationChange();
}
export function navigateToTweetCat(): void {
    pushOrReplace(FULL);          // ← 统一入口
    window.dispatchEvent(new PopStateEvent('popstate'));
    handleLocationChange();
}

/**
 * 进入 TweetCat 视图，确保：
 * 1. history 中压入 /i/grok#/tweetCatTimeLine
 * 2. Twitter Router 收到 popstate → 更新侧栏选中态
 * 3. 本扩展自己的 Guard 立即同步一次 handleLocationChange()
 */
// export function navigateToTweetCat(): void {
//     // ① 更新 URL
//     history.pushState({}, '', FULL);
//     logRoute('pushState →', FULL);
//
//     // ② 主动给 Twitter 的 SPA Router 一个 popstate 信号
//     window.dispatchEvent(new PopStateEvent('popstate'));   // ★ 关键
//
//     // ③ 我们自己的挂载 / 去抖
//     handleLocationChange();
// }

// /* ---------- 主动切换到 TweetCat 路由 ----------------------------- */
// export function routeToTweetCat() {
//     history.pushState({}, '', FULL);
//     logRoute('pushState →', FULL);
//     handleLocationChange();
// }

/* ---------- 退出 / 清理（占位，后续阶段实现具体逻辑） ------------- */
export function unroute() {
    logRoute('unroute – cleanup placeholder');
    history.replaceState({}, '', '/');   // 首次/单栈场景避免告警
}
/* ---------- document_start 时注册全局 Guard -------------------- */
export function initRouteGuard() {
    if (inited) return;           // ← 防重复
    inited = true;

    injectHistoryPatchIntoPage();

    logGuard('--------------->>>>✅ router init success');

    // ⬇️ 刷新 & 首次直链兜底
    if (location.hash.startsWith(HASH) && location.pathname !== PATH) {
        logGuard('first-load hash detected, force routing');
        routeToTweetCat();
    }

    handleLocationChange();

    window.addEventListener('popstate', () => {
        handleLocationChange();
    });
}

// Guard 去抖
function handleLocationChange() {
    const inTC = isInTweetCatRoute();
    if (inTC === currentInTC) return;
    currentInTC = inTC;
    window.dispatchEvent(new CustomEvent(inTC ? 'tc-mount' : 'tc-unmount'));
}

window.addEventListener('message', (e) => {
    if ((e.data as any)?.tcLocationChange) handleLocationChange();
});



export function handleGrokMenuClick(ev: MouseEvent): void {
    if (!location.hash.startsWith(HASH)) return;  // 不在 TweetCat → 让 Twitter 处理

    ev.preventDefault();                          // 阻止 Twitter 默认逻辑
    logGuard('grok menu click → exitTweetCat');
    history.replaceState({}, '', PATH);
    logRoute('replaceState →', PATH);
    window.dispatchEvent(new PopStateEvent('popstate'));
    handleLocationChange();                              // 清除 hash + 派发 tc-unmount
}


/** 未选中（细线 33×32）SVG  */
const GROK_SVG_NORMAL = `
<svg viewBox="0 0 33 32" aria-hidden="true" class="r-4qtqp9 r-yyyyoo r-dnmrzs r-bnwqim r-lrvibr r-m6rgpd r-18jsvk2 r-lwhw9o r-cnnz9e">
<g>
<path d="M12.745 20.54l10.97-8.19c.539-.4 1.307-.244 1.564.38 1.349 3.288.746 7.241-1.938 9.955-2.683 2.714-6.417 3.31-9.83 1.954l-3.728 1.745c5.347 3.697 11.84 2.782 15.898-1.324 3.219-3.255 4.216-7.692 3.284-11.693l.008.009c-1.351-5.878.332-8.227 3.782-13.031L33 0l-4.54 4.59v-.014L12.743 20.544m-2.263 1.987c-3.837-3.707-3.175-9.446.1-12.755 2.42-2.449 6.388-3.448 9.852-1.979l3.72-1.737c-.67-.49-1.53-1.017-2.515-1.387-4.455-1.854-9.789-.931-13.41 2.728-3.483 3.523-4.579 8.94-2.697 13.561 1.405 3.454-.899 5.898-3.22 8.364C1.49 30.2.666 31.074 0 32l10.478-9.466">
</path>
</g>
</svg>`;

/** 选中（粗线 42×42）SVG */
const GROK_SVG_SELECTED = `
<svg viewBox="0 0 42 42" aria-hidden="true" class="r-4qtqp9 r-yyyyoo r-dnmrzs r-bnwqim r-lrvibr r-m6rgpd r-18jsvk2 r-lwhw9o r-cnnz9e">
<g>
<path clip-rule="evenodd" d="M8 0C3.582 0 0 3.582 0 8v26c0 4.418 3.582 8 8 8h26c4.418 0 8-3.582 8-8V8c0-4.418-3.582-8-8-8H8zm19.997 17.35l-11.1 8.19 15.9-15.963v.015L37.391 5c-.082.117-.165.23-.248.345-3.49 4.804-5.194 7.153-3.826 13.03l-.009-.008c.943 4.001-.065 8.438-3.322 11.693-4.106 4.107-10.677 5.02-16.087 1.324l3.772-1.745c3.454 1.355 7.232.76 9.947-1.954 2.716-2.714 3.325-6.666 1.96-9.956-.259-.623-1.037-.78-1.58-.378zm-13.292-2.574c-3.314 3.31-3.983 9.047-.1 12.755l-.003.003L4 37c.663-.913 1.485-1.776 2.306-2.639l.04-.042c2.346-2.464 4.67-4.906 3.25-8.357-1.903-4.622-.795-10.038 2.73-13.56 3.664-3.66 9.06-4.583 13.568-2.729.998.37 1.867.897 2.545 1.387l-3.764 1.737c-3.505-1.47-7.52-.47-9.97 1.98z">
</path>
</g>
</svg>`;

function setGrokSvg(html: string) {
    const link = document.querySelector('a[href="/i/grok"]');
    const svg = link?.querySelector('svg');
    if (!svg) return;

    /* ------- 早退：已经是目标 viewBox 就什么也不做 ------- */
    const wantedViewBox =
        html.includes('viewBox="0 0 33 32"') ? '0 0 33 32' : '0 0 42 42';
    if (svg.getAttribute('viewBox') === wantedViewBox) return;

    /* ------- 真正执行替换 ------- */
    const tpl = document.createElement('template');
    tpl.innerHTML = html.trim();
    const tgtSvg = tpl.content.querySelector('svg')!;

    svg.setAttribute('viewBox', tgtSvg.getAttribute('viewBox')!);

    const curPath = svg.querySelector('path')!;
    const tgtPath = tgtSvg.querySelector('path')!;
    ['d', 'clip-rule', 'fill-rule', 'stroke-width'].forEach(attr => {
        const v = tgtPath.getAttribute(attr);
        if (v !== null) curPath.setAttribute(attr, v);
    });
}


export const swapSvgToNormal = () => setGrokSvg(GROK_SVG_NORMAL);
export const swapSvgToSelected = () => setGrokSvg(GROK_SVG_SELECTED);
