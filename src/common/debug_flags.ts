/** dbg.ts ---------------------------------------------------------- */
const __DEV__ = process.env.NODE_ENV !== 'production'

export const DBG = {
    MOUNT: false,
    VIS: false,
    PAGER: false,
    TWEET_MANAGER: false,
    NODE_POOL: false,
    ROUTE: false,
    GUARD: false,
    Database: false,
    TweetCache: false,
    TweetFetcher: false,
    TweetCursor: false,
    TweetBGTimer: false,
    TweetObjParse: true,
    TweetRender: true,
} as const;

/** 创建带模块名前缀、并受 DBG 开关控制的日志函数 */
function makeLogger(flagKey: keyof typeof DBG, label: string) {
    return (...args: any[]) => {
        if (DBG[flagKey] && __DEV__) console.log(`[${label}]`, ...args);
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
export const logDB = makeLogger('Database', 'Database');
export const logTC = makeLogger('TweetCache', 'TweetCache');
export const logFT = makeLogger('TweetFetcher', 'TweetFetcher');
export const logKC = makeLogger('TweetCursor', 'TweetCursor');
export const logBGT = makeLogger('TweetBGTimer', 'TweetBGTimer');
export const logTOP = makeLogger('TweetObjParse', 'TweetObjParse');
export const logRender = makeLogger('TweetRender', 'TweetRender');
