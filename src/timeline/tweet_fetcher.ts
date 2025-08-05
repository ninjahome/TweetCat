import {fetchTweets} from "./twitter_api";
import {sendMsgToService, sleep} from "../common/utils";
import {logFT} from "../common/debug_flags";
import {MsgType} from "../common/consts";
import {dbObjectToKol, TweetKol} from "../object/tweet_kol";


class KolCursor {
    userId: string;
    bottomCursor: string | null = null;
    topCursor: string | null = null;
    isEnd: boolean = false;
    latestFetchedAt: number | null = null;
    nextEligibleFetchTime: number = 0;
    failureCount: number = 0; // 新增字段：记录连续失败次数
    private readonly FETCH_COOL_DOWN = 10 * 60 * 1000;//10分钟

    constructor(userId: string) {
        this.userId = userId;
    }

    reset() {
        this.bottomCursor = null;
        this.topCursor = null;
        this.isEnd = false;
        this.latestFetchedAt = null;
        this.failureCount = 0;
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

    markCooldown(delayMs: number) {
    }

    markFailure() {
        this.failureCount++;
        const backoff = this.failureCount * this.FETCH_COOL_DOWN; // 最多 60 秒
        this.nextEligibleFetchTime = Date.now() + backoff;
    }

    resetFailureCount() {
        this.failureCount = 0;
    }

    canFetch(): boolean {
        return Date.now() >= this.nextEligibleFetchTime && !this.isEnd;
    }
}


export class TweetFetcher {
    private intervalId: number | null = null;
    private readonly FETCH_INTERVAL_MS = 120_000; // 每 60 秒轮询一次
    private readonly FETCH_LIMIT = 20;
    private readonly FETCH_GAP = 5000;
    private kolCursors: Map<string, KolCursor> = new Map();
    private kolIds: Map<string, TweetKol> = new Map();
    private currentGroupIndex = 0;
    private readonly MAX_KOL_PER_ROUND = 5;

    private lastKolLoadTime = 0;
    private KOL_REFRESH_INTERVAL = 10 * 60 * 1000;
    private readonly fetchGap: number;

    constructor() {
        const EXECUTION_OVERHEAD = 500;
        const overhead = this.MAX_KOL_PER_ROUND * EXECUTION_OVERHEAD;
        this.fetchGap = Math.max(0, Math.floor((this.FETCH_INTERVAL_MS - overhead) / this.MAX_KOL_PER_ROUND));
    }


    private getKolCursor(kolId: string): KolCursor {
        let cursor = this.kolCursors.get(kolId);
        if (!cursor) {
            cursor = new KolCursor(kolId);
            this.kolCursors.set(kolId, cursor);
        }
        return cursor;
    }

    start() {
        if (this.intervalId !== null) return;

        this.intervalId = window.setInterval(async () => {
            await this.fetchAllKols();
        }, this.FETCH_INTERVAL_MS);
    }

    stop() {
        if (this.intervalId !== null) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }

    private async maybeLoadKol() {
        if (Date.now() - this.lastKolLoadTime <= this.KOL_REFRESH_INTERVAL) return;

        const rsp = await sendMsgToService({}, MsgType.QueryAllKol);
        if (!rsp.success || !rsp.data) {
            console.warn("failed to load kols from service work");
            return
        }

        this.kolIds = dbObjectToKol(rsp.data as any[])

        this.lastKolLoadTime = Date.now();
    }

    private getNextKolGroup(): string[] {
        const allKolIds = Array.from(this.kolIds.keys());
        if (allKolIds.length === 0) return [];

        const total = allKolIds.length;
        const startIdx = (this.currentGroupIndex * this.MAX_KOL_PER_ROUND) % total;
        const groupKolIds = [];

        for (let i = 0; i < this.MAX_KOL_PER_ROUND && i < total; i++) {
            const idx = (startIdx + i) % total;
            groupKolIds.push(allKolIds[idx]);
        }

        this.currentGroupIndex++;
        return groupKolIds;
    }


    private async fetchOneKolBatch(userId: string, cursor: KolCursor): Promise<boolean> {
        try {
            const result = await fetchTweets(userId, this.FETCH_LIMIT, cursor.bottomCursor ?? undefined);
            const tweets = result.tweets ?? [];

            if (tweets.length > 0) {
                await sendMsgToService(result.wrapDbEntry, MsgType.CacheRawTweetData);
                cursor.updateBottom(result.nextCursor ?? null);
                cursor.latestFetchedAt = Date.now();
            }

            if (tweets.length === 0 || !result.nextCursor) {
                cursor.markEnd();
            }

            logFT(`${userId} fetched ${tweets.length} tweets`);
            return true;
        } catch (err) {
            const msg = typeof err === 'object' && err && 'message' in err ? String((err as any).message) : '';

            if (msg.includes('429')) {
                console.warn(`[Fetcher] 429 for ${userId}, cooldown`);
                cursor.markFailure();
                return false;
            }

            console.warn(`[Fetcher] fetch error for ${userId}`, err);
            return false;
        }
    }

    private async fetchAllKols() {

        await this.maybeLoadKol();

        const groupKolIds = this.getNextKolGroup();

        for (const userId of groupKolIds) {
            const cursor = this.getKolCursor(userId);
            if (!cursor.canFetch()) continue;

            const ok = await this.fetchOneKolBatch(userId, cursor);
            if (!ok) break; // 可选：遇到 429 就终止本轮，等待下一轮再试

            await sleep(this.fetchGap); // 控制请求速率
        }
    }


    private findNewestTweet() {

    }
}

export const tweetFetcher = new TweetFetcher();
