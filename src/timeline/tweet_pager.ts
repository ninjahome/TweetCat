/* ------------------------------------------------------------------ *
 * Tweet Pager State
 * ------------------------------------------------------------------ */
import {EntryObj} from "./tweet_entry";
import {logPager} from "../debug_flags";
import {fetchTweets, getUserIdByUsername} from "./twitter_api";
import {sendMsgToService, sleep} from "../utils";
import {MsgType} from "../consts";
import {BossOfTheWholeWorld} from "../database";
import {WrapEntryObj} from "./db_raw_tweet";


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

        const rsp = await sendMsgToService({
            limit: this.DEFAULT_INIT_PAGE,
            category: newCategoryId
        }, MsgType.DBReadTweetByCategoryId);
        if (!rsp.success) {
            console.warn("------>>> failed to switchCategory!");
            return;
        }

        const rawData = rsp.data as WrapEntryObj[];
        const tweets = unwrapEntryObj(rawData);
        this.tweetData.push(...tweets);

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

    private async bootstrap() {
        const rsp = await sendMsgToService({}, MsgType.TweetsBootStrap);
        if (!rsp.success) {
            console.warn("------>>> failed to check tweet bootstrap status!");
            return;
        }

        const {bootStrap, data} = rsp.data;

        if (!bootStrap) {
            logPager("Initial tweet cache already populated, skipping bootstrap");
            return;
        }

        try {
            const r = await fetchTweets(BossOfTheWholeWorld, 20, undefined); // 首次获取 20 条
            const wrapList = r.wrapDbEntry;
            await sendMsgToService(r.wrapDbEntry, MsgType.CacheRawTweetData);
            logPager(`Bootstrap cached ${wrapList.length} tweets for boss`);
        } catch (err) {
            logPager(`Bootstrap failed for boss`, err);
        }
    }

    async init() {
        await this.bootstrap();
    }
}

function unwrapEntryObj(rawData: WrapEntryObj[]): EntryObj[] {
    return rawData.map(row => WrapEntryObj.fromDbRow(row).toEntryObj());
}

export const tweetPager = new TweetPager();

