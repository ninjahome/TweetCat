export const DBG = {
    MOUNT: true,
    ANCHOR: false,
    VIS: true,
    CELL: false,
    PAGER: false,
    TWEET_MANAGER: true,
    NODE_POOL: false,
};

export function logMount(...args: any[]) {
    if (DBG.MOUNT) console.log.apply(console, args);
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

export function logVS(...args: any[]) {
    if (DBG.VIS) console.log.apply(console, args);
}
