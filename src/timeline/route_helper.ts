import browser from "webextension-polyfill";
import {logRoute} from "../common/debug_flags";
import {MsgType} from "../common/consts";

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

export function getTweetCatFlag(): boolean {
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
    const hasEntry = !!(history.state && (history.state as any).__tcEntered);
    const method: 'pushState' | 'replaceState' =
        (!hasEntry && history.length <= 1) ? 'replaceState' : 'pushState';
    const nextState = {...(history.state || {}), __tcEntered: true};



    const u = new URL(path, location.origin);
    u.search = '';

    history[method](nextState, '', u.pathname + u.hash);
    logRoute(`${method} →`, u.pathname + u.hash);
}

function sanitizeQueryNextTick() {
    requestAnimationFrame(() => {
        if (location.pathname === PATH &&
            location.hash.startsWith(HASH) &&
            location.search) {
            history.replaceState(history.state, '', `${PATH}${HASH}`);
            logRoute('sanitize → strip query to', `${PATH}${HASH}`);
        }
    });
}

export function routeToTweetCat() {
    if (location.hash === HASH) return; // 已在 TweetCat，不再 push/replace
    pushOrReplace(FULL);          // ← 统一入口
    sanitizeQueryNextTick();       // ← 新增
    handleLocationChange();
}

export function navigateToTweetCat(): void {
    if (location.hash === HASH) return; // 已在 TweetCat，不再 push/replace
    pushOrReplace(FULL);          // ← 统一入口
    window.dispatchEvent(new PopStateEvent('popstate'));
    handleLocationChange();
    sanitizeQueryNextTick();       // ← 新增
    setTweetCatFlag(false)
}

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

    logRoute('--------------->>>>✅ router init success');

    // ⬇️ 刷新 & 首次直链兜底
    if (location.hash.startsWith(HASH) && location.pathname !== PATH) {
        logRoute('first-load hash detected, force routing');
        routeToTweetCat();
    }

    handleLocationChange();

    window.addEventListener('popstate', () => {
        handleLocationChange();
    });
}

// Guard 去抖
export function handleLocationChange() {
    const inTC = isInTweetCatRoute();
    if (inTC === currentInTC) return;
    currentInTC = inTC;
    window.dispatchEvent(new CustomEvent(inTC ? MsgType.RouterTCMount : MsgType.RouterTcUnmount));
}

export function handleGrokMenuClick(ev: MouseEvent): void {
    if (!location.hash.startsWith(HASH)) return;

    ev.preventDefault();
    logRoute('grok menu click → exitTweetCat');
    history.replaceState({}, '', PATH);
    logRoute('replaceState →', PATH);
    window.dispatchEvent(new PopStateEvent('popstate'));
    handleLocationChange();
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
