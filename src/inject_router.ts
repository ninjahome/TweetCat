import {logRoute} from "./common/debug_flags";
import {MsgType} from "./common/consts";
import {postWindowMsg} from "./common/msg_obj";


/** 包裹指定方法；若已包裹则跳过 */
function wrap(fn: 'pushState' | 'replaceState') {
    const raw = (history as any)[fn];
    if ((raw as any).__tc_hooked) return;        // 仍是我们包的

    logRoute('[TC-Patch] ⚠️ re-hook', fn);

    function wrapped(this: History, ...args: any[]) {

        // ① 在真正导航之前，同步广播“即将导航”
        try {
            // 用 DOM 事件而不是 postMessage：同步、同一调用栈可达
            window.dispatchEvent(new CustomEvent(MsgType.RouterTCBeforeNav));
        } catch {}

        const ret = raw.apply(this, args);
        postWindowMsg(MsgType.IJLocationChange);
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
    window.addEventListener('popstate', () => postWindowMsg(MsgType.IJLocationChange));
    postWindowMsg(MsgType.IJLocationChange);                                 // 首次同步

    setInterval(ensureHooks, 200);          // watchdog（静默）
    (window as any).__tc_hist_patched = true;
    logRoute('[TC-Patch] ✅ router injection ready');
}
