import {fetchTweets, getUserIdByUsername} from "./twitter_api";
import {isTwitterUserProfile, sleep} from "../common/utils";
import {logFT} from "../common/debug_flags";
import {KolCursor, queryCursorByKolID, saveOneKolCursorToSW} from "../object/kol_cursor";
import {cacheTweetsToSW} from "./db_raw_tweet";
import {tweetFetchParam} from "../service_work/tweet_fetch_manager";

export class TweetFetcher {
    private readonly FETCH_LIMIT = 20;
    private readonly MIN_FETCH_GAP = 10_000;

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

    async fetchNewKolImmediate(kolName: string, kolID?: string) {
        if (!kolID) {
            kolID = await getUserIdByUsername(kolName) ?? undefined
            if (!kolID) {
                logFT("------>>> should have a kolID before fetching tweets")
                return
            }
        }

        const cursor = await queryCursorByKolID(kolID);
        if (!cursor.canFetchNew()) {
            logFT("------>>> no need to fetch new tweets right now for user:", kolID);
            return;
        }

        await tweetFetcher.fetchNewestOneKolBatch(cursor);

        await saveOneKolCursorToSW(cursor);
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

export async function fetchNewKolImmediate(kolName: string, kolUserId?: string) {
    const retry = isTwitterUserProfile() === kolName;
    if (retry) {
        logFT("🔒 current page is kol home, try to fetch tweets later for kol:", kolName);
    }

    dedupePush({kolName, kolUserId, retry});
    startLoopIfNeeded();
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


type QueueItem = { kolName: string; kolUserId?: string, retry: boolean; };

const TICK_MS = 15_000;
const queue: QueueItem[] = [];
let timerId: number | null = null;

// 简单去重：同 userId 或（无 id 时）同 name 不重复入队
function dedupePush(item: QueueItem) {
    const exists = queue.some(q =>
        (item.kolUserId && q.kolUserId === item.kolUserId) ||
        (!item.kolUserId && q.kolName === item.kolName)
    );
    if (!exists) queue.push(item);
    logFT("[dedupePush]🧪 queued kol newest tweets request :", item.kolName);
}

function startLoopIfNeeded() {
    if (timerId !== null) return;
    const tick = async () => {

        try {
            if (queue.length === 0) {
                stopLoop();
                return;
            }

            const item = queue.shift()!;
            try {
                logFT("[startLoopIfNeeded]🔁 timer starting fetching new tweets for kol:", item.kolName);
                await tweetFetcher.fetchNewKolImmediate(item.kolName, item.kolUserId);
                logFT("[startLoopIfNeeded]♻️ fetch  finished tweets for new kol:", item.kolName);

            } catch (e) {
                // 失败就丢弃；如果你想重试，可在这里 queue.push(item)
                console.warn("[immediate-queue] fetch failed:", item, e);
            }
        } finally {
            timerId = window.setTimeout(tick, TICK_MS);
        }
    };

    timerId = window.setTimeout(tick, 0);
}

function stopLoop() {
    if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
    }
}

window.addEventListener("beforeunload", stopLoop);

