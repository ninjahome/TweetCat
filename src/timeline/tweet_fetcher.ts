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
    failureCount: number = 0;

    private readonly FETCH_COOL_DOWN = 10 * 60 * 1000; // 10分钟

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

    markFailure() {
        this.failureCount++;
        const backoff = this.failureCount * this.FETCH_COOL_DOWN;
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
    private readonly FETCH_INTERVAL_MS = 120_000;
    private readonly FETCH_LIMIT = 20;
    private readonly MAX_KOL_PER_ROUND = 5;

    private readonly fetchGap: number;
    private kolCursors: Map<string, KolCursor> = new Map();
    private kolIds: Map<string, TweetKol> = new Map();
    private currentGroupIndex = 0;

    private lastKolLoadTime = 0;
    private readonly KOL_REFRESH_INTERVAL = 10 * 60 * 1000;

    constructor() {
        const EXECUTION_OVERHEAD = 500;
        const overhead = this.MAX_KOL_PER_ROUND * EXECUTION_OVERHEAD;
        this.fetchGap = Math.max(0, Math.floor((this.FETCH_INTERVAL_MS - overhead) / this.MAX_KOL_PER_ROUND));

        console.info(`[TweetFetcher] Initialized with:
  FETCH_INTERVAL_MS = ${this.FETCH_INTERVAL_MS}ms
  MAX_KOL_PER_ROUND = ${this.MAX_KOL_PER_ROUND}
  FETCH_LIMIT = ${this.FETCH_LIMIT}
  computed fetchGap = ${this.fetchGap}ms
`);
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

        console.info("[TweetFetcher] Started.");
        this.intervalId = window.setInterval(async () => {
            await this.fetchAllKols();
        }, this.FETCH_INTERVAL_MS);
    }

    stop() {
        if (this.intervalId !== null) {
            clearInterval(this.intervalId);
            this.intervalId = null;
            console.info("[TweetFetcher] Stopped.");
        }
    }

    private async maybeLoadKol() {
        if (Date.now() - this.lastKolLoadTime <= this.KOL_REFRESH_INTERVAL) return;

        const rsp = await sendMsgToService({}, MsgType.QueryAllKol);
        if (!rsp.success || !rsp.data) {
            console.warn("[TweetFetcher] Failed to load KOLs from service worker.");
            return;
        }

        this.kolIds = dbObjectToKol(rsp.data as any[]);
        this.lastKolLoadTime = Date.now();
        console.info(`[TweetFetcher] Loaded ${this.kolIds.size} KOLs.`);
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
            console.info(`[TweetFetcher] ▶️ Fetching tweets for ${userId}`);

            const result = await fetchTweets(userId, this.FETCH_LIMIT, cursor.bottomCursor ?? undefined);
            const tweets = result.tweets ?? [];

            if (tweets.length > 0) {
                await sendMsgToService(result.wrapDbEntry, MsgType.CacheRawTweetData);
                cursor.updateBottom(result.nextCursor ?? null);
                cursor.latestFetchedAt = Date.now();
                cursor.resetFailureCount();
            }

            if (tweets.length === 0 || !result.nextCursor) {
                cursor.markEnd();
            }

            logFT(`[TweetFetcher] ✅ ${userId} fetched ${tweets.length} tweets`);
            return true;
        } catch (err) {
            const msg = typeof err === 'object' && err && 'message' in err ? String((err as any).message) : '';

            if (msg.includes('429')) {
                console.warn(`[TweetFetcher] ❌ 429 for ${userId}, applying cooldown`);
                cursor.markFailure();
                return false;
            }

            console.warn(`[TweetFetcher] ❌ Fetch error for ${userId}`, err);
            return false;
        }
    }

    private async fetchAllKols() {
        console.info(`[TweetFetcher] ⏱ Starting round ${this.currentGroupIndex} at ${new Date().toISOString()}`);
        await this.maybeLoadKol();

        const groupKolIds = this.getNextKolGroup();

        for (const userId of groupKolIds) {
            const cursor = this.getKolCursor(userId);

            if (!cursor.canFetch()) {
                console.info(`[TweetFetcher] ⏸ Skipped ${userId} (cooldown or ended)`);
                continue;
            }

            const ok = await this.fetchOneKolBatch(userId, cursor);
            if (!ok) break; // 遇到 429 等异常中止本轮

            await sleep(this.fetchGap);
        }

        console.info(`[TweetFetcher] ✅ Round ${this.currentGroupIndex} complete.\n`);
    }

    private findNewestTweet() {
        // reserved for future logic
    }
}

export const tweetFetcher = new TweetFetcher();
