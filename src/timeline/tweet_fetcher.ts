import {fetchTweets, getUserIdByUsername} from "./twitter_api";
import {sendMsgToService, sleep} from "../common/utils";
import {logFT} from "../common/debug_flags";
import {KolCursor, saveOneKolCursorToSW} from "../object/kol_cursor";
import {cacheTweetsToSW} from "./db_raw_tweet";
import {MsgType} from "../common/consts";
import {EntryObj, parseTimelineFromGraphQL, TweetResult} from "./tweet_entry";
import {queryKolById, updateKolIdToSw} from "../object/tweet_kol";
import {resetNewestTweet, showNewestTweets} from "../content/tweetcat_web3_area";
import {setLatestFetchAt} from "./tweet_pager";
import {tweetFetchParam} from "../common/msg_obj";

const MIN_FETCH_GAP = 10_000;

export class TweetFetcher {
    private readonly FETCH_LIMIT = 20;
    private latestNewTweets: EntryObj[] = [];
    private lastCaptureTIme: number = 0;

    constructor() {
    }

    updateCaptureTime() {
        this.lastCaptureTIme = Date.now();
    }

    private async fetchNewestOneKolBatch(cursor: KolCursor): Promise<EntryObj[]> {
        try {

            logFT(`\n\n[fetchNewestOneKolBatch] ▶️ Fetching newest tweets for ${cursor.userId} top cursor=${cursor.topCursor}`);
            const result = await fetchTweets(cursor.userId, this.FETCH_LIMIT, cursor.topCursor ?? undefined);
            const tweets = result.tweets ?? [];

            if (tweets.length === 0 || !result.topCursor) {
                logFT(`[fetchNewestOneKolBatch] ✅ ${cursor.userId} no more new tweets `);
                cursor.waitForNextNewestRound(null, result.nextCursor);
                return [];
            }

            const dataDeleted = await cacheTweetsToSW(cursor.userId, result.wrapDbEntry)
            cursor.waitForNextNewestRound(result.topCursor, result.nextCursor);
            cursor.updateCacheStatus(dataDeleted > 0);

            logFT(`\n\n[fetchNewestOneKolBatch] ✅ ${cursor.userId} fetched ${tweets.length} newest tweets`);
            return result.tweets;

        } catch (err) {
            this.process429Error(err, cursor)
            return []
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
        let retriesLeft = 10;
        for (let i = 0; i < cursors.length; i++) {
            const delta = Date.now() - this.lastCaptureTIme;
            if (delta < MIN_FETCH_GAP) {
                retriesLeft--;
                logFT(`------>>>⏱️need to fetch after about[${delta}(ms)] , try chance remains[${retriesLeft}]`)
                if (retriesLeft <= 0) {
                    logFT("❌ tweets fetch failed for this round:");
                    return;
                }

                await sleep(MIN_FETCH_GAP);
                i--;
                continue;
            }

            const cursorData = cursors[i];
            const cursor = KolCursor.fromJSON(cursorData);
            printStatus("------>>>🧪before process:", cursor)

            if (newest) {
                const newItems = await this.fetchNewestOneKolBatch(cursor);
                this.latestNewTweets.push(...newItems);
            } else await this.fetchHistoryOneKolBatch(cursor);

            printStatus("------>>>✅after process:", cursor)
            await saveOneKolCursorToSW(cursor);

            await sleep(MIN_FETCH_GAP);
        }

        if (newest && this.latestNewTweets.length > 0) {
            showNewestTweets(this.latestNewTweets).finally(() => {
                this.latestNewTweets = [];
            });
        }
    }

    resetNotifications() {
        this.latestNewTweets = [];
        resetNewestTweet();
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

    if (data.newest) setLatestFetchAt(Date.now());

    logFT(`[startToFetchTweets]🚄 tweet syncing complete.\n`);
}


export async function fetchImmediateInNextRound(kolName: string, kolUserId?: string) {
    let kolID = kolUserId
    if (!kolID) {
        kolID = await getUserIdByUsername(kolName) ?? undefined
        if (!kolID) {
            logFT("------>>> should have a kolID before fetching tweets")
            return
        }
    }
    const cachedData = tempCacheForTweetOfKolProfilePage.get(kolID);
    if (!cachedData) {
        logFT(`[fetchImmediateInNextRound]🚄  need to load tweets in next timer round.\n`);
        await sendMsgToService(kolID, MsgType.TimerKolInQueueAtOnce);
    } else {
        logFT(`[fetchImmediateInNextRound]💾  use cached data directly.\n`);
        const wrapList = cachedData.wrapDbEntry;
        await sendMsgToService({kolId: kolID, data: wrapList}, MsgType.TweetCacheToDB);
        tempCacheForTweetOfKolProfilePage.delete(kolID);
    }
}

function printStatus(tag: string, cursor: KolCursor) {
    const now = Date.now();
    logFT(`[${tag}  KolCursor] 🧾UserId: ${cursor.userId}`);
    logFT(`           🔝 TopCursor: ${cursor.topCursor ?? "null"}`);
    logFT(`           🔚 BottomCursor: ${cursor.bottomCursor ?? "null"}`);
    logFT(`           ⏱️ Next Newest Fetch In: ${cursor.nextNewestFetchTime > now ? ((cursor.nextNewestFetchTime - now) / 1000).toFixed(1) + "s" : "ready"}`);
    logFT(`           🕰️ Next History Fetch In: ${cursor.nextHistoryFetchTime > now ? ((cursor.nextHistoryFetchTime - now) / 1000).toFixed(1) + "s" : "ready"}`);
    logFT(`           💾 Cache Enough: ${cursor.cacheEnough}`);
    logFT(`           ❌ Failure Count: ${cursor.failureCount}`);
    logFT(`           🌐 Network Valid: ${cursor.networkValid}`);
}


export async function startToCheckKolId(ids: any[]) {

    for (let i = 0; i < ids.length; i++) {
        const kolInfo = ids[i];
        logFT("------>>>🌐start to fetch id for:", JSON.stringify(kolInfo))

        const kolId = await getUserIdByUsername(kolInfo.kolName);
        if (!kolId) {
            logFT("------>>> failed find kol id for:", kolInfo.kolName);
            continue;
        }

        kolInfo.kolUserId = kolId;
        await updateKolIdToSw(kolInfo);
        logFT("------>>>✅after to fetch id for:", JSON.stringify(kolInfo))

        await sleep(MIN_FETCH_GAP);
    }
}

const tempCacheForTweetOfKolProfilePage = new Map<string, TweetResult>();

export async function processCapturedTweets(result: any, kolId: string) {

    tweetFetcher.updateCaptureTime();
    const r = parseTimelineFromGraphQL(result);

    const kol = await queryKolById(kolId);
    if (!kol) {
        logFT(`no need to send tweets data to service for : ${kolId}`);
        tempCacheForTweetOfKolProfilePage.set(kolId, r);
        return;
    }

    const wrapList = r.wrapDbEntry;
    await sendMsgToService({kolId: kolId, data: wrapList}, MsgType.TweetCacheToDB);
    logFT(`captured tweets cached ${wrapList.length} tweets for ${kolId}`);
}