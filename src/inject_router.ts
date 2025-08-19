import {logRoute} from "./common/debug_flags";
import {postToContent} from "./injection";
import {MsgType} from "./common/consts";


/** 包裹指定方法；若已包裹则跳过 */
function wrap(fn: 'pushState' | 'replaceState') {
    const raw = (history as any)[fn];
    if ((raw as any).__tc_hooked) return;        // 仍是我们包的

    logRoute('[TC-Patch] ⚠️ re-hook', fn);

    function wrapped(this: History, ...args: any[]) {
        const ret = raw.apply(this, args);
        postToContent(MsgType.IJLocationChange);
        return ret;
    }

    (wrapped as any).__tc_hooked = true;
    (history as any)[fn] = wrapped;
}

/** 确保 pushState / replaceState 均被 hook */
function ensureHooks() {
    wrap('pushState');
    wrap('replaceState');
}

/** 初始化 —— 只执行一次 */
export function initPagePatch(): void {
    if ((window as any).__tc_hist_patched) return;

    ensureHooks();                          // 首次 hook
    window.addEventListener('popstate', () => postToContent(MsgType.IJLocationChange));
    postToContent(MsgType.IJLocationChange);                                 // 首次同步

    setInterval(ensureHooks, 200);          // watchdog（静默）
    (window as any).__tc_hist_patched = true;
    logRoute('[TC-Patch] ✅ router injection ready');
}
