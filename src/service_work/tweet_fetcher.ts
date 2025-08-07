import {fetchTweets} from "../timeline/twitter_api";
import {sleep} from "../common/utils";
import {logFT} from "../common/debug_flags";
import {queryKolIdsFromSW} from "../object/tweet_kol";
import {EntryObj} from "../timeline/tweet_entry";
import {KolCursor, loadAllCursorFromSW, saveKolCursorToSW} from "../object/kol_cursor";
import {cacheTweetsToSW} from "../timeline/db_raw_tweet";
import {BossOfTheTwitter} from "../common/database";

export class TweetFetcher {
    private intervalId: number | null = null;
    private readonly FETCH_INTERVAL_MS = 120_000;
    private readonly FETCH_LIMIT = 20;
    private readonly MAX_KOL_PER_ROUND = 5;
    private readonly MIN_FETCH_GAP = 5000;
    private readonly TIME_INTERVAL_AT_START_FETCH = 5000
    private readonly KOL_SCAN_LIMIT = this.MAX_KOL_PER_ROUND * 3;

    private readonly fetchGap: number;
    private kolCursors: Map<string, KolCursor> = new Map();
    private kolIds: string[] = [];

    private currentNewGroupIndex = 0;
    private currentOldGroupIndex = 0;

    private newestFetch = false;

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
        this.syncNewestAtStartup().then(() => {
            this.intervalId = window.setInterval(async () => {
                await this.fetchTweetsPeriodic(this.newestFetch);
                this.newestFetch = !this.newestFetch;
            }, this.FETCH_INTERVAL_MS);
        })
    }

    stop() {
        if (this.intervalId !== null) {
            clearInterval(this.intervalId);
            this.intervalId = null;
            logFT("[TweetFetcher] Stopped.");
        }
    }

    private async syncNewestAtStartup() {
        logFT("[syncNewestAtStartup]🌳 Started (immediate fire).");
        this.kolCursors = await loadAllCursorFromSW();
        this.kolIds = await queryKolIdsFromSW();

        for (const userId of this.kolIds) {
            try {
                const cursor = this.getKolCursor(userId);
                const ok = await this.fetchNewestOneKolBatch(userId, cursor);
                if (!ok) break;
                await sleep(this.TIME_INTERVAL_AT_START_FETCH);
            } catch (e) {
                logFT("StartupSync", userId, "failed:", e);
            }
        }

        logFT(`[syncNewestAtStartup]🚄 fast sync at start up complete.\n`);
        await saveKolCursorToSW(this.kolCursors);
    }


    private getNextKolGroup(newest: boolean = true): string[] {
        const total = this.kolIds.length;
        if (total === 0) return [];

        const result: string[] = [];
        const maxScan = Math.min(this.KOL_SCAN_LIMIT, total);
        let scanCount = 0;
        let found = 0;

        let idx = newest ? this.currentNewGroupIndex : this.currentOldGroupIndex;

        while (scanCount < maxScan && found < this.MAX_KOL_PER_ROUND) {
            const userId = this.kolIds[idx % total];
            const cursor = this.getKolCursor(userId);
            const canUse = newest ? cursor.canFetchNew() : cursor.needFetchOld();
            if (canUse) {
                result.push(userId);
                found++;
            }
            scanCount++;
            idx++;
        }

        if (newest) {
            this.currentNewGroupIndex = idx % total;
        } else {
            this.currentOldGroupIndex = idx % total;
        }

        return result;
    }

    private async fetchNewestOneKolBatch(userId: string, cursor: KolCursor): Promise<boolean> {
        try {

            logFT(`\n\n[fetchNewestOneKolBatch] ▶️ Fetching newest tweets for ${userId}`);
            const result = await fetchTweets(userId, this.FETCH_LIMIT, cursor.topCursor ?? undefined);
            const tweets = result.tweets ?? [];

            if (tweets.length === 0 || !result.topCursor) {
                logFT(`[fetchNewestOneKolBatch] ✅ ${userId} no more new tweets `);
                cursor.waitForNextNewestRound(null, result.nextCursor);
                return true;
            }

            const dataDeleted = await cacheTweetsToSW(userId, result.wrapDbEntry)
            cursor.waitForNextNewestRound(result.topCursor, result.nextCursor);
            cursor.updateCacheStatus(dataDeleted > 0);

            logFT(`\n\n[fetchNewestOneKolBatch] ✅ ${userId} fetched ${tweets.length} newest tweets`);
            return true;

        } catch (err) {
            this.process429Error(err, cursor, userId)
            return false
        }
    }

    private async fetchHistoryOneKolBatch(userId: string, cursor: KolCursor): Promise<boolean> {
        try {
            logFT(`[fetchHistoryOneKolBatch] ▶️ Fetching history tweets for ${userId} `);
            const bottomCursor = cursor.bottomCursor
            if (!bottomCursor) {
                console.warn("------->>> should not load history data without bottom cursor")
                return false;
            }

            const result = await fetchTweets(userId, this.FETCH_LIMIT, bottomCursor);
            const tweets = result.tweets ?? [];

            if (tweets.length === 0 || !result.nextCursor) {
                logFT(`[fetchHistoryOneKolBatch] ✅ ${userId} no more history tweets`);
                cursor.updateBottom(result.nextCursor);
                return true;
            }

            const dataDeleted = await cacheTweetsToSW(userId, result.wrapDbEntry)
            cursor.updateBottom(result.nextCursor);
            cursor.updateCacheStatus(dataDeleted > 0)
            logFT(`[fetchHistoryOneKolBatch] ✅ ${userId} fetched ${tweets.length} history tweets `);
            return true;

        } catch (err) {
            this.process429Error(err, cursor, userId)
            return false
        }
    }


    private process429Error(err: any, cursor: KolCursor, userId: string) {
        cursor.markFailure();
        const msg = typeof err === 'object' && err && 'message' in err ? String((err as any).message) : '';

        if (!msg.includes('429')) {
            logFT(`[process429Error] 🔴 Fetch error for ${userId}`, err);
            return;
        }
        console.warn(`[process429Error] ❌ 429 for ${userId}, applying cooldown`);
    }

    async fetchTweetsPeriodic(newest: boolean = true) {
        this.kolIds = await queryKolIdsFromSW();

        const groupKolIds = this.getNextKolGroup(newest);
        if (groupKolIds.length === 0) {
            logFT(`[fetchTweetsPeriodic] 😅  ${newest ? "[Newest]" : "[History]"} round ${newest ? this.currentNewGroupIndex : this.currentOldGroupIndex} no kol ids at ${new Date().toISOString()}`);
            return;
        }

        logFT(`[fetchTweetsPeriodic] ⏱ Starting ${newest ? "[Newest]" : "[History]"} round ${newest ? this.currentNewGroupIndex : this.currentOldGroupIndex} groupKolIds【${groupKolIds}】at ${new Date().toISOString()}`);

        for (const userId of groupKolIds) {
            const cursor = this.getKolCursor(userId);

            let ok = false;
            if (newest) ok = await this.fetchNewestOneKolBatch(userId, cursor);
            else ok = await this.fetchHistoryOneKolBatch(userId, cursor);
            if (!ok) break;

            await sleep(this.fetchGap);
        }

        logFT(`[fetchTweetsPeriodic] ✅  ${newest ? "[Newest]" : "[History]"}  Round ${newest ? this.currentNewGroupIndex : this.currentOldGroupIndex} complete.\n`);
        await saveKolCursorToSW(this.kolCursors);
    }

    async findNewestTweetsOfSomeBody(): Promise<EntryObj[]> {
        const result = await fetchTweets(BossOfTheTwitter, this.FETCH_LIMIT);
        const tweets = result.tweets ?? [];
        return tweets
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