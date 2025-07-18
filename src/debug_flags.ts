export const DBG = {
    MOUNT: true,
    ANCHOR: true,
    VIS: false,
    PAGE: false,
    CELL: false,
    ENTRY_PAGER: false,
    TWEET_MANAGER: true,
    NODE_POOL: false,
    DIFF: true,
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
