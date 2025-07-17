// debug_flags.ts
export const DBG = {
    MOUNT: true,   // ← 这次测试要开
    ANCHOR: true,   // ← 这次测试要开
    VIS: false,  // 可留作以后扩展
    PAGE: false,
    CELL: false,
    ENTRY_PAGER: true,
    TWEET_MANAGER: true,
    NODE_POOL:false,
    DIFF:true,
};

export function logMount(...args: any[]) {
    if (DBG.MOUNT) console.log.apply(console, args);
}

export function logAnchor(...args: any[]) {
    if (DBG.ANCHOR) console.log.apply(console, args);
}

export function logPager(...args: any[]) {
    if (DBG.ENTRY_PAGER) console.log.apply(console, args);
}

export function logPool(...args: any[]) {
    if (DBG.NODE_POOL) console.log.apply(console, args);
}


export function logTweetMgn(...args: any[]) {
    if (DBG.TWEET_MANAGER) console.log.apply(console, args);
}
export function logDiff(...args: any[]) {
    if (DBG.DIFF) console.log.apply(console, args);
}
