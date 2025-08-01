/** dbg.ts ---------------------------------------------------------- */
export const DBG = {
    MOUNT: false,
    VIS: false,
    PAGER: false,
    TWEET_MANAGER: false,
    NODE_POOL: false,
    ROUTE: true,    // ← 新增：路由相关
    GUARD: true,    // ← 新增：guard 相关
} as const;

/** 创建带模块名前缀、并受 DBG 开关控制的日志函数 */
function makeLogger(flagKey: keyof typeof DBG, label: string) {
    return (...args: any[]) => {
        if (DBG[flagKey]) console.log(`[${label}]`, ...args);
    };
}

/* 导出各模块 logger ------------------------------------------------ */
export const logMount = makeLogger('MOUNT', 'TweetCellMount');
export const logVS = makeLogger('VIS', 'VirtualScroller');
export const logPager = makeLogger('PAGER', 'TweetDataPager');
export const logTweetMgn = makeLogger('TWEET_MANAGER', 'TweetMgr');
export const logPool = makeLogger('NODE_POOL', 'TweetNodePool');
export const logRoute = makeLogger('ROUTE', 'Route');
export const logGuard = makeLogger('GUARD', 'Guard');
