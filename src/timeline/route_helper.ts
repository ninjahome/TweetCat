import browser from "webextension-polyfill";
import {logGuard, logRoute} from "../debug_flags";

let inited = false;
let currentInTC: boolean | null = null;      // 记录上一次状态
const PATH   = '/i/grok';
const HASH   = '#/tweetCatTimeLine';
const FULL   = `${PATH}${HASH}`;

initRouteGuard();

export function isInTweetCatRoute(): boolean {
    return location.pathname === PATH && location.hash.startsWith(HASH);
}

function injectHistoryPatchIntoPage() {
    if (document.getElementById('tc-history-patch')) return;

    const url = browser.runtime.getURL('js/injection.js');
    const s   = document.createElement('script');
    s.id      = 'tc-history-patch';
    s.src     = url;
    s.onload  = () => s.remove();      // 注入后自删
    document.documentElement.appendChild(s);
}


/* ---------- 主动切换到 TweetCat 路由 ----------------------------- */
export function routeToTweetCat() {
    history.pushState({}, '', FULL);
    logRoute('pushState →', FULL);
    handleLocationChange();
}

/* ---------- 退出 / 清理（占位，后续阶段实现具体逻辑） ------------- */
export function unroute() {
    logRoute('unroute – cleanup placeholder');
    history.pushState({}, '', '/');
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


/**
 * 进入 TweetCat 视图，确保：
 * 1. history 中压入 /i/grok#/tweetCatTimeLine
 * 2. Twitter Router 收到 popstate → 更新侧栏选中态
 * 3. 本扩展自己的 Guard 立即同步一次 handleLocationChange()
 */
export function navigateToTweetCat(): void {
    // ① 更新 URL
    history.pushState({}, '', FULL);
    logRoute('pushState →', FULL);

    // ② 主动给 Twitter 的 SPA Router 一个 popstate 信号
    window.dispatchEvent(new PopStateEvent('popstate'));   // ★ 关键

    // ③ 我们自己的挂载 / 去抖
    handleLocationChange();
}
