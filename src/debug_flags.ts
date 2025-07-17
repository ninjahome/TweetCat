// debug_flags.ts
export const DBG = {
    MOUNT: true,   // ← 这次测试要开
    ANCHOR: true,   // ← 这次测试要开
    VIS: false,  // 可留作以后扩展
    PAGE: false,
    CELL: false,
    ENTRY_PAGER: false,
    TWEET_MANAGER: true,
    NODE_POOL:true,
};

export function logMount(...args: any[]) {
    if (DBG.MOUNT) console.log.apply(console, args);
}

export function logAnchor(...args: any[]) {
    if (DBG.ANCHOR) console.log.apply(console, args);
}

export function logEntry(...args: any[]) {
    if (DBG.ENTRY_PAGER) console.log.apply(console, args);
}


export function logPool(...args: any[]) {
    if (DBG.NODE_POOL) console.log.apply(console, args);
}

