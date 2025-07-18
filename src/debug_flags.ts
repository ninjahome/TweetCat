export const DBG = {
    MOUNT: true,
    ANCHOR: false,
    VIS: false,
    CELL: false,
    PAGER: false,
    TWEET_MANAGER: false,
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
    if (DBG.PAGER) console.log.apply(console, args);
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
