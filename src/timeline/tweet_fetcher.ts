import {fetchTweets} from "./twitter_api";
import {sendMsgToService, sleep} from "../common/utils";
import {logFT} from "../common/debug_flags";
import {MsgType} from "../common/consts";
import {dbObjectToKol, TweetKol} from "../object/tweet_kol";
import {EntryObj} from "./tweet_entry";

class KolCursor {
    userId: string;
    bottomCursor: string | null = null;
    topCursor: string | null = null;
    isEnd: boolean = false;
    latestFetchedAt: number | null = null;
    nextEligibleFetchTime: number = 0;
    failureCount: number = 0;

    private readonly FETCH_COOL_DOWN = 20 * 60 * 1000; // 20分钟
    private readonly MIN_KOL_FETCH_INTERVAL = 15 * 60 * 1000; // 每个 KOL 最小间隔 15 分钟

    constructor(userId: string) {
        this.userId = userId;
    }

    reset() {
        this.bottomCursor = null;
        this.topCursor = null;
        this.isEnd = false;
        this.latestFetchedAt = null;
        this.failureCount = 0;
        this.setNextFetchAfter(this.MIN_KOL_FETCH_INTERVAL);
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
        this.setNextFetchAfter(backoff);
    }

    resetFailureCount() {
        this.failureCount = 0;
        this.setNextFetchAfter(this.MIN_KOL_FETCH_INTERVAL);
    }

    setNextFetchAfter(ms: number) {
        this.nextEligibleFetchTime = Date.now() + ms;
    }

    canFetch(): boolean {
        return Date.now() >= this.nextEligibleFetchTime && !this.isEnd;
    }

    getDebugInfo(): string {
        const now = Date.now();
        const status = this.isEnd ? "🔚 ended"
            : now < this.nextEligibleFetchTime ? "⏸ cooling down"
                : "✅ ready";

        const nextIn = Math.max(0, this.nextEligibleFetchTime - now);
        const nextSec = Math.round(nextIn / 1000);

        const lastFetched = this.latestFetchedAt
            ? new Date(this.latestFetchedAt).toISOString()
            : "never";

        return `[KolCursor] ${this.userId}
  status: ${status}
  failureCount: ${this.failureCount}
  nextFetchIn: ${nextSec}s
  latestFetchedAt: ${lastFetched}
  bottomCursor: ${this.bottomCursor ?? "null"}`;
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
    private readonly MIN_FETCH_GAP = 5000;

    constructor() {
        const EXECUTION_OVERHEAD = 500;
        const overhead = this.MAX_KOL_PER_ROUND * EXECUTION_OVERHEAD;
        this.fetchGap = Math.max(this.MIN_FETCH_GAP, Math.floor((this.FETCH_INTERVAL_MS - overhead) / this.MAX_KOL_PER_ROUND));

        logFT(`[TweetFetcher] Initialized with:
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

        logFT("[TweetFetcher] Started (immediate fire).");

        // // 🔥 立即执行一次
        // this.fetchAllKols().catch(err => {
        //     console.error("[TweetFetcher] Immediate fetchAllKols failed:", err);
        // });

        this.intervalId = window.setInterval(async () => {
            await this.fetchAllKols();
        }, this.FETCH_INTERVAL_MS);
    }

    stop() {
        if (this.intervalId !== null) {
            clearInterval(this.intervalId);
            this.intervalId = null;
            logFT("[TweetFetcher] Stopped.");
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
        logFT(`[TweetFetcher] Loaded ${this.kolIds.size} KOLs.`);
    }

    private getNextKolGroup(): string[] {
        const allKolIds = Array.from(this.kolIds.values()).map(kol => kol.kolUserId) as string[];
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
            logFT(`[TweetFetcher] ▶️ Fetching tweets for ${userId} cursor info:${cursor.getDebugInfo()}`);

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
        await this.maybeLoadKol();

        const groupKolIds = this.getNextKolGroup();
        logFT(`[TweetFetcher] ⏱ Starting round ${this.currentGroupIndex} groupKolIds【${groupKolIds}】at ${new Date().toISOString()}`);

        for (const userId of groupKolIds) {
            const cursor = this.getKolCursor(userId);

            if (!cursor.canFetch()) {
                logFT(`[TweetFetcher] ⏸ Skipped ${userId} (cooldown or ended)`);
                continue;
            }

            const ok = await this.fetchOneKolBatch(userId, cursor);
            if (!ok) break; // 遇到 429 等异常中止本轮

            await sleep(this.fetchGap);
        }

        logFT(`[TweetFetcher] ✅ Round ${this.currentGroupIndex} complete.\n`);
    }

    async findNewestTweet(): Promise<EntryObj[]> {
        return []
    }
}

export const tweetFetcher = new TweetFetcher();
document.addEventListener('DOMContentLoaded', function onLoadOnce() {
    tweetFetcher.start();
    logFT('[TweetFetcher] 🚀 DOMContentLoaded: starting fetcher...');
    document.removeEventListener('DOMContentLoaded', onLoadOnce);
});

window.addEventListener('beforeunload', () => {
    logFT('[TweetFetcher] 🛑 beforeunload: stopping fetcher...');
    tweetFetcher.stop();
});