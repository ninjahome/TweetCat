import {fetchTweets, getUserIdByUsername} from "./twitter_api";
import {sendMsgToService, sleep} from "../common/utils";
import {logFT, logIC} from "../common/debug_flags";
import {KolCursor, saveOneKolCursorToSW} from "../object/kol_cursor";
import {cacheTweetsToSW, WrapEntryObj} from "./db_raw_tweet";
import {MsgType} from "../common/consts";
import {EntryObj, parseTimelineFromGraphQL, TweetMediaEntity, TweetObj} from "./tweet_entry";
import {queryKolById, updateKolIdToSw} from "../object/tweet_kol";
import {resetNewestTweet, showNewestTweets} from "../content/tweetcat_web3_area";
import {setLatestFetchAt} from "./tweet_pager";
import {tweetFetchParam} from "../common/msg_obj";
import {extractMp4UrlList} from "./render_video";
import {cacheTweetInStatus} from "../content/content_x402";
import {LRUCache} from "../common/lru_map";

const MIN_FETCH_GAP = 5_000;

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
    }

    private async fetchHistoryOneKolBatch(cursor: KolCursor): Promise<boolean> {

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
        return true
    }

    private async process429Error(err: any) {
        const msg = typeof err === 'object' && err && 'message' in err ? String((err as any).message) : '';

        if (!msg.includes('429')) {
            logFT(`[process429Error] 🔴 Fetch error for ${err}`);
            return;
        }
        console.warn(`[process429Error] ❌ 429  applying cooldown`);
        await sendMsgToService({}, MsgType.TokenFreeze);
    }

    async startFetchLogic(cursors: any[], newest: boolean) {
        try {
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

        } catch (err) {
            await this.process429Error(err)
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
    if (!cachedData || cachedData.length === 0) {
        logFT(`[fetchImmediateInNextRound]🚄  need to load tweets in next timer round.\n`);
        await sendMsgToService(kolID, MsgType.TimerKolInQueueAtOnce);
    } else {
        logFT(`[fetchImmediateInNextRound]💾  use cached data directly.\n`);
        await sendMsgToService({kolId: kolID, data: cachedData}, MsgType.TweetCacheToDB);
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

const tempCacheForTweetOfKolProfilePage = new LRUCache<string, WrapEntryObj[]>(1000);

export async function processCapturedTweets(result: any, kolId: string) {

    tweetFetcher.updateCaptureTime();

    await sendMsgToService({}, MsgType.TokenUsedByUser);

    const r = parseTimelineFromGraphQL(result, "tweets");
    const wrapList = r.wrapDbEntry;
    const kol = await queryKolById(kolId);
    // console.log("----------------->>>>", r.tweets);
    cacheVideoTweet(r.tweets);

    if (!kol) {
        logIC(`no need to send tweets data to service for : ${kolId}`);
        tempCacheForTweetOfKolProfilePage.set(kolId, wrapList);
        return;
    }


    await sendMsgToService({kolId: kolId, data: wrapList}, MsgType.TweetCacheToDB);
    logIC(`captured tweets cached ${wrapList.length} tweets for ${kolId}`);
}

export async function processCapturedTweetDetail(result: any) {
    const res = parseTimelineFromGraphQL(result, "tweetDetail");
    cacheVideoTweet(res.tweets);
    await cacheTweetInStatus(res.tweets)
}

export async function processCapturedHomeLatest(result: any) {
    const res = parseTimelineFromGraphQL(result, "home");

    cacheVideoTweet(res.tweets);

    const kolToCache = new Set<string>();
    for (const w of res.wrapDbEntry) {

        let cachedData = tempCacheForTweetOfKolProfilePage.get(w.userId)
        if (!cachedData) {
            cachedData = [];
            tempCacheForTweetOfKolProfilePage.set(w.userId, cachedData);
        }
        cachedData.push(w);

        const kol = await queryKolById(w.userId);
        if (!!kol) {
            kolToCache.add(w.userId);
        }
    }

    logIC(`captured tweets at home result`, res);

    for (const kolId of kolToCache) {
        const list = tempCacheForTweetOfKolProfilePage.get(kolId) ?? [];
        if (list.length === 0) continue;
        await sendMsgToService({kolId: kolId, data: list}, MsgType.TweetCacheToDB);
        tempCacheForTweetOfKolProfilePage.delete(kolId);
    }
}

const videoCacheMap = new Map<string, { e: TweetMediaEntity, f: string, t: string }>();

function _parseVideoFromObj(tid: string, type: string, tweet?: TweetObj): boolean {
    if (!tweet) return false;

    const tweetContent = tweet.tweetContent;
    const mediaList: TweetMediaEntity[] =
        tweetContent.extended_entities?.media?.length
            ? tweetContent.extended_entities.media
            : tweetContent.entities?.media || [];

    const videos = mediaList.filter(m => m.type === 'video' || m.type === 'animated_gif');
    if (videos.length === 0) return false;

    const fileName = "TweetCat_" + tweet.author.screenName + "@" + tid;
    logIC("tweet with videos info:", type, tid, videos);
    videoCacheMap.set(tid, {e: videos[0], f: fileName, t: type});
    return true;
}

function cacheVideoTweet(tweets: EntryObj[]) {
    tweets.forEach(obj => {

        let tidForVideo = obj.tweet.tweetContent.id_str
        const retweetObj = obj.tweet.retweetedStatus;

        if (retweetObj) {
            tidForVideo = retweetObj.rest_id;
        }

        let found = _parseVideoFromObj(tidForVideo, "main", obj.tweet);
        if (found) return;

        found = _parseVideoFromObj(tidForVideo, "quoted", obj.tweet.quotedStatus);
        if (found) return;

        if (retweetObj) {
            found = _parseVideoFromObj(tidForVideo, "retweeted", retweetObj);
            if (found) return;

            found = _parseVideoFromObj(tidForVideo, "retweetedQuoted", retweetObj.quotedStatus);
            if (found) return;
        }
    });
}

export function videoParamForTweets(sid: string): { m: string[], f: string, t: string } | null {
    const videoInfo = videoCacheMap.get(sid)
    if (!videoInfo) {
        return null;
    }

    const array = extractMp4UrlList(videoInfo.e.video_info?.variants ?? []);
    return {m: array, f: videoInfo.f, t: videoInfo.t};
}