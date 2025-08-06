import {fetchTweets} from "./twitter_api";
import {sleep} from "../common/utils";
import {logFT} from "../common/debug_flags";
import {queryKolIdsFromSW} from "../object/tweet_kol";
import {EntryObj} from "./tweet_entry";
import {debugKolCursor, KolCursor, loadAllCursorFromSW, saveKolCursorToSW} from "../object/kol_cursor";
import {cacheTweetsToSW} from "./db_raw_tweet";
import {BossOfTheTwitter} from "../common/database";

export class TweetFetcher {
    private intervalId: number | null = null;
    private readonly FETCH_INTERVAL_MS = 120_000;
    private readonly FETCH_LIMIT = 20;
    private readonly MAX_KOL_PER_ROUND = 5;
    private readonly KOL_REFRESH_INTERVAL = 10 * 60 * 1000;
    private readonly MIN_FETCH_GAP = 5000;
    private readonly KOL_SCAN_LIMIT = this.MAX_KOL_PER_ROUND * 3;

    private readonly fetchGap: number;
    private kolCursors: Map<string, KolCursor> = new Map();
    private kolIds: string[] = [];

    private currentNewGroupIndex = 0;
    private currentOldGroupIndex = 0;

    private lastKolLoadTime = 0;

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

        loadAllCursorFromSW().then(map => {
            this.kolCursors = map;
            logFT(`[TweetFetcher] Loaded ${this.kolCursors.size} KolCursors from IDB.`);
        });

        this.intervalId = window.setInterval(async () => {
            await this.fetchTweetsPeriodic();
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
        this.kolIds = await queryKolIdsFromSW();
        this.lastKolLoadTime = Date.now();
        logFT(`[TweetFetcher] Loaded ${this.kolIds.length} KOLs.`);
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
            const userId = this.kolIds[idx];
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
            logFT(`\n\n[TweetFetcher] ▶️ Fetching newest tweets for ${userId} cursor info:${debugKolCursor(cursor)}`);

            const result = await fetchTweets(userId, this.FETCH_LIMIT, cursor.topCursor ?? undefined);
            const tweets = result.tweets ?? [];

            if (tweets.length === 0 || !result.topCursor) {
                logFT(`[NewestFetch] ✅ ${userId} no more new tweets cursor info:${debugKolCursor(cursor)}`);
                cursor.waitForNextNewestRound();
                return true;
            }

            const dataDeleted = await cacheTweetsToSW(userId, result.wrapDbEntry)
            cursor.waitForNextNewestRound(result.topCursor, dataDeleted > 0);
            logFT(`\n\n[TweetFetcher] ✅ ${userId} fetched ${tweets.length} newest tweets cursor info:${debugKolCursor(cursor)} from server [b:${result.nextCursor,",", result.topCursor}]`);
            return true;

        } catch (err) {
            this.process429Error(err, cursor, userId)
            return false
        }
    }


    private async fetchHistoryOneKolBatch(userId: string, cursor: KolCursor): Promise<boolean> {
        try {
            logFT(`[TweetFetcher] ▶️ Fetching history tweets for ${userId} cursor info:${debugKolCursor(cursor)}`);
            const bottomCursor = cursor.bottomCursor
            if (!bottomCursor) {
                console.warn("------->>> should not load history data without bottom cursor")
                return false;
            }

            const result = await fetchTweets(userId, this.FETCH_LIMIT, bottomCursor);
            const tweets = result.tweets ?? [];

            if (tweets.length === 0 || !result.nextCursor) {
                logFT(`[NewestFetch] ✅ ${userId} no more history tweets cursor info:${debugKolCursor(cursor)}`);
                cursor.updateBottom();
                return true;
            }

            const dataDeleted = await cacheTweetsToSW(userId, result.wrapDbEntry)
            cursor.updateBottom(result.nextCursor, dataDeleted > 0);
            logFT(`[TweetFetcher] ✅ ${userId} fetched ${tweets.length} history tweets cursor info:${debugKolCursor(cursor)}`);
            return true;

        } catch (err) {
            this.process429Error(err, cursor, userId)
            return false
        }
    }


    private process429Error(err: any, cursor: KolCursor, userId: string) {
        const msg = typeof err === 'object' && err && 'message' in err ? String((err as any).message) : '';

        if (!msg.includes('429')) {
            console.warn(`[TweetFetcher] ❌ Fetch error for ${userId}`, err);
            return;
        }

        console.warn(`[TweetFetcher] ❌ 429 for ${userId}, applying cooldown`);
        cursor.markFailure();
    }

    private async fetchTweetsPeriodic(newest: boolean = true) {
        await this.maybeLoadKol();

        const groupKolIds = this.getNextKolGroup(newest);
        if (groupKolIds.length === 0) {
            logFT(`[fetchAllKols] 😅  ${newest ? "[Newest]" : "[History]"} round ${newest ? this.currentNewGroupIndex : this.currentOldGroupIndex} no kol ids at ${new Date().toISOString()}`);
            return;
        }

        logFT(`[fetchAllKols] ⏱ Starting ${newest ? "[Newest]" : "[History]"} round ${newest ? this.currentNewGroupIndex : this.currentOldGroupIndex} groupKolIds【${groupKolIds}】at ${new Date().toISOString()}`);

        for (const userId of groupKolIds) {
            const cursor = this.getKolCursor(userId);

            let ok = false;
            if (newest) ok = await this.fetchNewestOneKolBatch(userId, cursor);
            else ok = await this.fetchHistoryOneKolBatch(userId, cursor);
            if (!ok) break;

            await sleep(this.fetchGap);
        }

        logFT(`[fetchAllKols] ✅  ${newest ? "[Newest]" : "[History]"}  Round ${newest ? this.currentNewGroupIndex : this.currentOldGroupIndex} complete.\n`);
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