import {fetchTweets} from "./twitter_api";
import {sleep} from "../common/utils";
import {logFT} from "../common/debug_flags";
import {KolCursor, saveKolCursorToSW, saveOneKolCursorToSW} from "../object/kol_cursor";
import {cacheTweetsToSW} from "./db_raw_tweet";
import {tweetFetchParam} from "../service_work/tweet_fetch_manager";

export class TweetFetcher {
    private readonly FETCH_LIMIT = 20;
    private readonly MIN_FETCH_GAP = 5000;

    constructor() {
    }

    private async fetchNewestOneKolBatch(cursor: KolCursor): Promise<boolean> {
        try {

            logFT(`\n\n[fetchNewestOneKolBatch] ▶️ Fetching newest tweets for ${cursor.userId} top cursor=${cursor.topCursor}`);
            const result = await fetchTweets(cursor.userId, this.FETCH_LIMIT, cursor.topCursor ?? undefined);
            const tweets = result.tweets ?? [];

            if (tweets.length === 0 || !result.topCursor) {
                logFT(`[fetchNewestOneKolBatch] ✅ ${cursor.userId} no more new tweets `);
                cursor.waitForNextNewestRound(null, result.nextCursor);
                return true;
            }

            const dataDeleted = await cacheTweetsToSW(cursor.userId, result.wrapDbEntry)
            cursor.waitForNextNewestRound(result.topCursor, result.nextCursor);
            cursor.updateCacheStatus(dataDeleted > 0);

            logFT(`\n\n[fetchNewestOneKolBatch] ✅ ${cursor.userId} fetched ${tweets.length} newest tweets`);
            return true;

        } catch (err) {
            this.process429Error(err, cursor)
            return false
        }
    }

    private async fetchHistoryOneKolBatch(cursor: KolCursor): Promise<boolean> {
        try {
            logFT(`[fetchHistoryOneKolBatch] ▶️ Fetching history tweets for ${cursor.userId} `);
            const bottomCursor = cursor.bottomCursor
            if (!bottomCursor) {
                console.warn("------->>> should not load history data without bottom cursor")
                return false;
            }

            const result = await fetchTweets(cursor.userId, this.FETCH_LIMIT, bottomCursor);
            const tweets = result.tweets ?? [];

            if (tweets.length === 0 || !result.nextCursor) {
                logFT(`[fetchHistoryOneKolBatch] ✅ ${cursor.userId} no more history tweets`);
                cursor.updateBottom(result.nextCursor);
                return true;
            }

            const dataDeleted = await cacheTweetsToSW(cursor.userId, result.wrapDbEntry)
            cursor.updateBottom(result.nextCursor);
            cursor.updateCacheStatus(dataDeleted > 0)
            logFT(`[fetchHistoryOneKolBatch] ✅ ${cursor.userId} fetched ${tweets.length} history tweets `);
            return true;

        } catch (err) {
            this.process429Error(err, cursor)
            return false
        }
    }

    private process429Error(err: any, cursor: KolCursor) {
        cursor.markFailure();
        const msg = typeof err === 'object' && err && 'message' in err ? String((err as any).message) : '';

        if (!msg.includes('429')) {
            logFT(`[process429Error] 🔴 Fetch error for ${cursor.userId}`, err);
            return;
        }
        console.warn(`[process429Error] ❌ 429 for ${cursor.userId}, applying cooldown`);
    }

    async startFetchLogic(cursors: any[], newest: boolean) {

        for (let i = 0; i < cursors.length; i++) {
            const cursorData = cursors[i];
            const cursor = KolCursor.fromJSON(cursorData);
            printStatus("------>>>🧪before process:", cursor)
            let ok = false;

            if (newest) ok = await this.fetchNewestOneKolBatch(cursor);
            else ok = await this.fetchHistoryOneKolBatch(cursor);

            printStatus("------>>>✅after process:", cursor)
            await saveOneKolCursorToSW(cursor);

            if (!ok) break;

            await sleep(this.MIN_FETCH_GAP);
        }

    }
}

export const tweetFetcher = new TweetFetcher();

export async function startToFetchTweets(data: tweetFetchParam) {

    logFT("[startToFetchTweets]🌳 Started tweet syncing", data.cursors, data.newest);

    const cursors = data.cursors
    if (cursors.length === 0) {
        logFT("no cursor to process");
        return;
    }

    await tweetFetcher.startFetchLogic(cursors, data.newest);

    logFT(`[startToFetchTweets]🚄 tweet syncing complete.\n`);
}

function printStatus(tag: string, cursor: KolCursor) {
    const now = Date.now();
    console.log(`[${tag}  KolCursor] 🧾UserId: ${cursor.userId}`);
    console.log(`           🔝 TopCursor: ${cursor.topCursor ?? "null"}`);
    console.log(`           🔚 BottomCursor: ${cursor.bottomCursor ?? "null"}`);
    console.log(`           ⏱️ Next Newest Fetch In: ${cursor.nextNewestFetchTime > now ? ((cursor.nextNewestFetchTime - now) / 1000).toFixed(1) + "s" : "ready"}`);
    console.log(`           🕰️ Next History Fetch In: ${cursor.nextHistoryFetchTime > now ? ((cursor.nextHistoryFetchTime - now) / 1000).toFixed(1) + "s" : "ready"}`);
    console.log(`           💾 Cache Enough: ${cursor.cacheEnough}`);
    console.log(`           ❌ Failure Count: ${cursor.failureCount}`);
    console.log(`           🌐 Network Valid: ${cursor.networkValid}`);
}
