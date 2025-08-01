/* ------------------------------------------------------------
 * injection.ts   – 运行在 page-world
 * 1. hook history.pushState / replaceState
 * 2. 路由变动时 postMessage({tcLocationChange:true})
 * 3. watchdog 每 200 ms 检查；只有被覆盖时才打印 ⚠️ re-hook
 * ------------------------------------------------------------ */

/** 向 content-script 广播路由变化 */
function post(): void {
    window.postMessage({ tcLocationChange: true }, '*');
}

/** 包裹指定方法；若已包裹则跳过 */
function wrap(fn: 'pushState' | 'replaceState') {
    const raw = (history as any)[fn];
    if ((raw as any).__tc_hooked) return;        // 仍是我们包的

    console.debug('[TC-Patch] ⚠️ re-hook', fn);

    function wrapped(this: History, ...args: any[]) {
        const ret = raw.apply(this, args);
        post();
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
function initPagePatch(): void {
    if ((window as any).__tc_hist_patched) return;

    ensureHooks();                          // 首次 hook
    window.addEventListener('popstate', () => post());
    post();                                 // 首次同步

    setInterval(ensureHooks, 200);          // watchdog（静默）
    (window as any).__tc_hist_patched = true;
    console.debug('[TC-Patch] ✅ injection ready');
}

initPagePatch();                          // 显式执行
