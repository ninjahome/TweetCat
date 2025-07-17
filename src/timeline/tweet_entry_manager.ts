/* ------------------------------------------------------------------ *
 * Tweet Pager State
 * ------------------------------------------------------------------ */
import {EntryObj} from "./tweet_entry";
import {DBG, logEntry} from "../debug_flags";
import {fetchTweets} from "./twitter_api";

let tweetData: EntryObj[] = [];
let currentIdx = 0;                // 下次 getNextTweets 起始位置（基于 tweetData）
let nextCursor: string | null = null;
let isEnd = false;                 // 后端是否已无更多数据
let inFlight: Promise<void> | null = null;   // 串行化 fetch
const DEFAULT_INIT_PAGE = 20;      // 可按需调整

const userID = '1315345422123180033'////1861626580579360768//1315345422123180033
/* ------------------------------------------------------------------ *
 * 初始化：确保至少抓到 initialPageSize 条（或直到 isEnd）
 * ------------------------------------------------------------------ */
export async function initTweetPager(initialPageSize: number = DEFAULT_INIT_PAGE): Promise<void> {
    if (tweetData.length > 0) {
        if (DBG.ENTRY_PAGER) console.log('[Pager] init skipped, already have %d tweets.', tweetData.length);
        return;
    }
    await ensureCacheSize(initialPageSize);
    currentIdx = 0;
    if (DBG.ENTRY_PAGER) {
        console.log('[Pager] init done tweets=%d nextCursor=%s isEnd=%s',
            tweetData.length, nextCursor, isEnd);
    }
}

/* ------------------------------------------------------------------ *
 * 公开接口：获取下一页 tweet
 * 行为：
 *   1. 若缓存足够 -> 直接 slice。
 *   2. 缓存不足 -> 循环 fetch（使用 nextCursor）补足，直到够 pageSize 或 isEnd。
 *   3. 返回取得的实际条数（可能 < pageSize，当 isEnd 且没有更多）。
 *   4. 更新 currentIdx。
 * ------------------------------------------------------------------ */
export async function getNextTweets(pageSize: number): Promise<EntryObj[]> {
    if (pageSize <= 0) return [];
    // 目标索引（不含）：currentIdx + pageSize
    const target = currentIdx + pageSize;

    // 如果缓存不足，则补齐
    if (tweetData.length < target && !isEnd) {
        await ensureCacheSize(target);
    }

    // 现在可安全 slice（最多到 tweetData.length）
    const endIdx = Math.min(target, tweetData.length);
    if (currentIdx >= endIdx) {
        logEntry('[Pager] no more tweets. currentIdx=%d len=%d isEnd=%s',
            currentIdx, tweetData.length, isEnd);
        return [];
    }

    const page = tweetData.slice(currentIdx, endIdx);
    currentIdx = endIdx; // 前进

    logEntry('[Pager] getNextTweets -> %d items (req=%d) cur=%d/%d isEnd=%s',
        page.length, pageSize, currentIdx, tweetData.length, isEnd);
    return page;
}

/* ------------------------------------------------------------------ *
 * 内部：确保缓存长度 >= minNeeded
 * 会按 pageSize = DEFAULT_INIT_PAGE（或动态batch）分批拉取
 * NOTE: 这里按需也可使用“缺多少补多少”的 batchSize；当前选择每次拉 DEFAULT_INIT_PAGE，
 *       便于后端分页一致性；如要严格按缺口补，可传 diff。
 * ------------------------------------------------------------------ */
async function ensureCacheSize(minNeeded: number): Promise<void> {
    while (tweetData.length < minNeeded && !isEnd) {
        await fetchBatch(Math.max(DEFAULT_INIT_PAGE, minNeeded - tweetData.length));
    }
}

/* ------------------------------------------------------------------ *
 * 串行抓取一批
 *  - 将新 tweets push 进 tweetData
 *  - 更新 nextCursor / isEnd
 *  - 防止重入（inFlight）
 * ------------------------------------------------------------------ */
async function fetchBatch(batchSize: number): Promise<void> {
    // 若已有请求在飞，复用它（避免并发重复请求）
    if (inFlight) {
        await inFlight;
        return;
    }
    inFlight = (async () => {
        logEntry('[Pager] fetchBatch size=%d cursor=%s', batchSize, nextCursor);
        const {tweets, nextCursor: nc, isEnd: end} =
            await fetchTweets(userID, batchSize, nextCursor ?? undefined);

        if (tweets?.length) {
            tweetData.push(...tweets);
        }
        nextCursor = nc ?? null;
        isEnd = end;

        logEntry('[Pager] fetched %d -> total=%d nextCursor=%s isEnd=%s',
            tweets?.length ?? 0, tweetData.length, nextCursor, isEnd);
    })();

    try {
        await inFlight;
    } finally {
        inFlight = null;
    }
}

/**
 * HARD RESET: 重置 Tweet Pager 的全部运行时状态。
 * - 清空缓存 tweetData
 * - currentIdx -> 0
 * - nextCursor -> null
 * - isEnd -> false
 * - inFlight 请求引用清空
 *
 * 注意：不会自动重新抓取；调用者如果需要初始数据，需随后调用 initTweetPager()
 * 或直接下一次 getNextTweets(pageSize) 让其自动补货（如果你按之前代码那样实现）。
 */
export async function resetTweetPager(): Promise<void> {
    // 等待正在进行的抓取，避免 race（忽略错误，反正都要重置）
    if (inFlight) {
        try {
            await inFlight;
        } catch {
            /* ignore */
        }
    }

    tweetData = [];
    currentIdx = 0;
    nextCursor = null;
    isEnd = false;
    inFlight = null;

    logEntry('[Pager] HARD RESET completed. tweets=0 cur=0 nextCursor=null isEnd=false');
}
