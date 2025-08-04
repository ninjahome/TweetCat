/* ------------------------------------------------------------------ *
 * Tweet Pager State
 * ------------------------------------------------------------------ */
import {EntryObj} from "./tweet_entry";
import {logPager} from "../debug_flags";
import {fetchTweets, getUserIdByUsername} from "./twitter_api";
import {sendMsgToService} from "../utils";
import {MsgType} from "../consts";
import {WrapEntryObj} from "./db_raw_tweet";

/* ------------------------------------------------------------------ *
 * 内部状态
 * ------------------------------------------------------------------ */
let tweetData: EntryObj[] = [];
let currentIdx = 0;                // 下次 getNextTweets 起始位置（基于 tweetData）
let nextCursor: string | null = null;
let isEnd = false;                 // 后端是否已无更多数据
let inFlight: Promise<number> | null = null;   // 串行化 fetch，resolve=新增条数
const DEFAULT_INIT_PAGE = 20;      // 可按需调整

// 用于缓存已存在的 tweet id，防止重复（核心补丁）
let seenIds: Set<string> = new Set();

const userID = '1315345422123180033'; // 1594535159373733889//1315345422123180033//1491062057734606851
//nuonuo888999
//error userid  1594535159373733889  //CHNN00001
//1491062057734606851//ZhuzhuJennifer //updateHeightAt
/* ------------------------------------------------------------------ *
 * 初始化：确保至少抓到 initialPageSize 条（或直到 isEnd）
 * ------------------------------------------------------------------ */
async function initTweetPagerCache(initialPageSize: number = DEFAULT_INIT_PAGE): Promise<void> {
    // console.log("-------->>>> user id by name:",await getUserIdByUsername('ZhuzhuJennifer'));
    if (tweetData.length > 0) {
        logPager('[Pager] init skipped, already have %d tweets.', tweetData.length);
        return;
    }
    await ensureCacheSize(initialPageSize);
    currentIdx = 0;
    logPager(`[Pager] init done tweets=${tweetData.length} nextCursor=${nextCursor} isEnd=${isEnd}`);
}


/* ------------------------------------------------------------------ *
 * 公开接口：获取下一页 tweet
 * 行为：
 *   1. 若缓存足够 -> 直接 slice。
 *   2. 缓存不足 -> 循环 fetch（使用 nextCursor）补足，直到够 pageSize 或 isEnd。
 *   3. 返回取得的实际条数（可能 < pageSize，当 isEnd 且没有更多）。
 *   4. 更新 currentIdx。
 * ------------------------------------------------------------------ */
async function getNextTweets(pageSize: number): Promise<EntryObj[]> {
    if (pageSize <= 0) return [];

    const target = currentIdx + pageSize;

    // 如果缓存不足，则补齐
    if (tweetData.length < target && !isEnd) {
        await ensureCacheSize(target);
    }

    // 现在可安全 slice（最多到 tweetData.length）
    const endIdx = Math.min(target, tweetData.length);
    if (currentIdx >= endIdx) {
        logPager('[Pager] no more tweets. currentIdx=%d len=%d isEnd=%s', currentIdx, tweetData.length, isEnd);
        return [];
    }

    const page = tweetData.slice(currentIdx, endIdx);
    currentIdx = endIdx; // 前进

    logPager(`[Pager] getNextTweets -> ${page.length} items (req=${pageSize}) cur=${currentIdx}/${tweetData.length} isEnd=${isEnd} first=${page[0]?.entryId} last=${page[page.length - 1]?.entryId}`);

    return page;
}


/* ------------------------------------------------------------------ *
 * 内部：确保缓存长度 >= minNeeded
 * 会按 pageSize = DEFAULT_INIT_PAGE（或动态 batch）分批拉取
 * NOTE: 若一次批次没有新增（全部重复），即刻停止，避免死循环。
 * ------------------------------------------------------------------ */
async function ensureCacheSize(minNeeded: number): Promise<void> {
    while (tweetData.length < minNeeded && !isEnd) {
        const lack = minNeeded - tweetData.length;
        const batchSize = Math.max(DEFAULT_INIT_PAGE, lack);
        const added = await fetchBatch(batchSize);

        if (added === 0) {
            // 没有新增内容 -> 极可能cursor复用 / 服务端重复返回；立即停止以免死循环
            logPager('[Pager] ensureCacheSize no new tweets (len=%d need=%d cursor=%s end=%s) -- break',
                tweetData.length, minNeeded, nextCursor, isEnd);
            break;
        }

        // 如果服务端没有 nextCursor 且没声明 isEnd，这里也要防御退出
        if (!nextCursor && !isEnd && tweetData.length < minNeeded) {
            logPager('[Pager] ensureCacheSize missing nextCursor but not end; stop to avoid repeat.');
            break;
        }
    }
}


/* ------------------------------------------------------------------ *
 * 串行抓取一批
 *  - 将“新的 / 未见过 id 的” tweets push 进 tweetData
 *  - 更新 nextCursor / isEnd
 *  - 防止重入（inFlight）
 * 返回新增条数
 * ------------------------------------------------------------------ */
async function fetchBatch(batchSize: number): Promise<number> {
    // 若已有请求在飞，复用它（避免并发重复请求）
    if (inFlight) {
        return await inFlight;
    }

    inFlight = (async () => {
        logPager(`[Pager] fetchBatch size=${batchSize} cursor=${nextCursor}`);

        let tweets: EntryObj[] = [];
        let nc: string | null | undefined = null;
        let end = false;

        try {
            const r = await fetchTweets(userID, batchSize, nextCursor ?? undefined);
            tweets = r.tweets ?? [];
            nc = r.nextCursor ?? null;
            end = tweets.length === 0 || nextCursor === null;
            sendMsgToService(r.wrapDbEntry, MsgType.CacheRawTweetData).then();

            // tweets = await loadByKolId(userID, batchSize);
            // nc = null;
            // end = true;

        } catch (err) {
            logPager('[Pager] fetchBatch ERROR %o', err);
            // 出错时，不推进 cursor；added=0
            return 0;
        }

        // 去重
        let added = 0, dup = 0;
        for (const t of tweets) {
            const id = t.entryId;
            if (!id) {
                dup++; // 无 id，当重复处理
                continue;
            }
            if (seenIds.has(id)) {
                dup++;
                continue;
            }
            seenIds.add(id);
            tweetData.push(t);
            added++;
        }

        nextCursor = nc ?? null;
        isEnd = end;

        logPager(`[Pager] fetched raw=${tweets.length} added=${added} dup=${dup} -> total=${tweetData.length} nextCursor=${nextCursor} isEnd=${isEnd}`);

        return added;
    })();

    try {
        return await inFlight;
    } finally {
        inFlight = null;
    }
}


/* ------------------------------------------------------------------ *
 * HARD RESET: 重置 Tweet Pager 的全部运行时状态。
 * - 清空缓存 tweetData / seenIds
 * - currentIdx -> 0
 * - nextCursor -> null
 * - isEnd -> false
 * - inFlight 请求引用清空
 *
 * 注意：不会自动重新抓取；调用者若需初始数据，之后调用 initTweetPager()
 * ------------------------------------------------------------------ */
async function resetTweetPager(): Promise<void> {
    // 等待正在进行的抓取，避免 race（忽略错误，反正都要重置）
    if (inFlight) {
        try {
            await inFlight;
        } catch {
            /* ignore */
        }
    }

    tweetData = [];
    seenIds = new Set();
    currentIdx = 0;
    nextCursor = null;
    isEnd = false;
    inFlight = null;

    logPager('[Pager] HARD RESET completed. tweets=0 cur=0 nextCursor=null isEnd=false');
}

async function loadByKolId(kolId: string, limit: number = 10): Promise<EntryObj[]> {
    const rsp = await sendMsgToService({kolId, limit}, MsgType.ReadTweetByKolIdFromDBCache).then();
    if (!rsp.success) {
        logPager(`load cached tweet for[${kolId}] form database failed`);
        return []
    }
    const rawData = rsp.data as WrapEntryObj[];
    return rawData.map(row => WrapEntryObj.fromDbRow(row).toEntryObj());
}

async function loadCachedTweetsByCategory(limit = 20): Promise<EntryObj[]> {
    const data: EntryObj[] = []
    return data;
}


export class KolCursor {
    userId: string;
    bottomCursor: string | null = null;
    topCursor: string | null = null;
    isEnd: boolean = false;
    latestFetchedAt: number | null = null;

    constructor(userId: string) {
        this.userId = userId;
    }

    reset() {
        this.bottomCursor = null;
        this.topCursor = null;
        this.isEnd = false;
        this.latestFetchedAt = null;
    }

    markEnd() {
        this.isEnd = true;
    }

    updateBottom(cursor: string | null) {
        this.bottomCursor = cursor;
        if (!cursor) this.isEnd = true;
    }

    updateTop(cursor: string | null) {
        this.topCursor = cursor;
    }
}


export class TweetPager {
    private tweetData: EntryObj[] = [];
    private currentIdx = 0;
    private nextCursor: string | null = null;
    private isEnd = false;
    private inFlight: Promise<number> | null = null;
    private seenIds: Set<string> = new Set();
    private currentCategoryId: number | null = null;
    private kolCursors: Map<string, KolCursor> = new Map();
    private readonly DEFAULT_INIT_PAGE = 20;

    constructor() {
        this.maybeBootstrapInitialData().then();
    }

    private getKolCursor(kolId: string): KolCursor {
        let cursor = this.kolCursors.get(kolId);
        if (!cursor) {
            cursor = new KolCursor(kolId);
            this.kolCursors.set(kolId, cursor);
        }
        return cursor;
    }

    async switchCategory(newCategoryId: number | null = null) {

        await this.resetPager();

        this.currentCategoryId = newCategoryId;

        if (this.currentCategoryId) {
            this.tweetData = await this.loadCachedTweetsByCategory(this.DEFAULT_INIT_PAGE);
        } else {
            this.tweetData = await this.loadCachedTweetsAllKols(this.DEFAULT_INIT_PAGE);
        }

        logPager(`[switchCategory] category changed -> ${newCategoryId}, preload tweets=${this.tweetData.length}`);
    }

    async getNextTweets(pageSize: number): Promise<EntryObj[]> {
        if (pageSize <= 0) return [];
        const target = this.currentIdx + pageSize;

        // 如果缓存不足，可预留异步增量加载逻辑（比如调用 ensureCacheSize）
        // 这里只实现从聚合池读取
        const endIdx = Math.min(target, this.tweetData.length);
        if (this.currentIdx >= endIdx) {//TODO::
            logPager(`[Pager] no more tweets. currentIdx=${this.currentIdx} len=${this.tweetData.length} isEnd=${this.isEnd}`);
            return [];
        }
        const page = this.tweetData.slice(this.currentIdx, endIdx);
        this.currentIdx = endIdx;
        logPager(`[Pager] getNextTweets -> ${page.length} items (req=${pageSize}) cur=${this.currentIdx}/${this.tweetData.length} isEnd=${this.isEnd} first=${page[0]?.entryId} last=${page[page.length - 1]?.entryId}`);
        return page;
    }

    /** 强制重置所有状态，恢复初始 */
    async resetPager() {
        if (this.inFlight) {
            try {
                await this.inFlight;
            } catch { /* ignore */
            }
        }
        this.tweetData = [];
        this.seenIds = new Set();
        this.currentIdx = 0;
        this.nextCursor = null;
        this.isEnd = false;
        this.inFlight = null;
        logPager('[Pager] HARD RESET completed.');
    }

    // ------ 内部方法 --------

    /** 分类聚合（或全部 KOL 聚合），本地缓存聚合流 */
    private async loadCachedTweetsByCategory(limit: number): Promise<EntryObj[]> {
        // TODO: 实现实际的聚合查询，先占位
        // 推荐思路：查询所有 KOL userId（按分类过滤或查全部），对每个 userId 调用 loadCachedTweetsByUserId，然后合并、排序、slice
        // 伪代码示例（需要你实际实现 queryKolsByCategory 等 API）：
        /*
        const kolIds = categoryId
            ? await queryKolsByCategory(categoryId)
            : await queryAllKols();
        let allTweets: EntryObj[] = [];
        for (const userId of kolIds) {
            const tweets = await loadCachedTweetsByUserId(userId, limit);
            allTweets.push(...tweets);
        }
        allTweets.sort((a, b) => b.tweet.tweetContent.timestamp - a.tweet.tweetContent.timestamp);
        return allTweets.slice(0, limit);
        */
        return []; // 占位
    }

    private async loadCachedTweetsAllKols(limit: number): Promise<EntryObj[]> {
        return []
    }

    private async maybeBootstrapInitialData() {
        const rsp = await sendMsgToService({}, MsgType.TweetsBootStrap).then();
        if (!rsp.success) {
            console.warn("------>>> failed to check tweet bootstrap status!");
            return;
        }

        const {bootStrap, data} = rsp.data;

        if (!bootStrap) {
            logPager("Initial tweet cache already populated, skipping bootstrap");
            return;
        }

        const initialKols = data as any[]; // 你已有逻辑
        for (const kol of initialKols) {
            try {
                const r = await fetchTweets(kol.kolUserId, 20, undefined); // 首次获取 20 条
                const wrapList = r.wrapDbEntry;
                await sendMsgToService(r.wrapDbEntry, MsgType.CacheRawTweetData);
                logPager(`Bootstrap cached ${wrapList.length} tweets for kol=${kol.kolUserId}`);
            } catch (err) {
                logPager(`Bootstrap failed for kol=${kol.kolUserId}`, err);
            }
        }
    }
}

export const tweetPager = new TweetPager();

