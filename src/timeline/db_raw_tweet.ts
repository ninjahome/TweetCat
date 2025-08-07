import {EntryObj} from "./tweet_entry";
import pLimit from 'p-limit';

import {
    __tableCachedTweets,
    __tableKolsInCategory, BossOfTheTwitter,
    countTable,
    databasePutItem,
    databaseQueryByFilter,
    databaseQueryByIndex,
    databaseQueryByIndexRange,
    idx_userid_time, initialKols,
    pruneOldDataIfNeeded
} from "../common/database";
import {logTC} from "../common/debug_flags";
import {sendMsgToService, sleep} from "../common/utils";
import {MsgType} from "../common/consts";
import {fetchTweets} from "./twitter_api";

const MAX_TWEETS_PER_KOL = 1000;


export class WrapEntryObj {
    tweetId: string;
    userId: string;
    timestamp: number;
    rawJson: any;

    constructor(entryId: string, userId: string, timestamp: number, rawJson: any) {
        this.tweetId = entryId;
        this.userId = userId;
        this.timestamp = timestamp;
        this.rawJson = rawJson;
    }

    static fromEntryObj(entry: EntryObj, rawJson: any): WrapEntryObj {
        return new WrapEntryObj(
            entry.entryId,
            entry.tweet.author.authorID,
            new Date(entry.tweet.tweetContent.created_at).getTime(),
            rawJson
        );
    }

    toEntryObj(): EntryObj {
        return new EntryObj(this.rawJson);
    }

    static fromDbRow(row: any): WrapEntryObj {
        return new WrapEntryObj(row.tweetId, row.userId, row.timestamp, row.rawJson);
    }
}

/**************************************************
 *
 *               service work api
 *
 * *************************************************/
export async function cacheRawTweets(kolId: string, rawTweets: WrapEntryObj[]): Promise<number> {
    const limit = pLimit(5);
    try {
        await Promise.all(
            rawTweets.map(obj => limit(() => databasePutItem(__tableCachedTweets, obj)))
        );
        const dataLen = await pruneOldDataIfNeeded(kolId, idx_userid_time, __tableCachedTweets, MAX_TWEETS_PER_KOL);
        logTC(`[cacheRawTweets] ✅ [${rawTweets.length}] tweets cached, [${dataLen}] old tweets deleted for kol[${kolId}]`);
        return dataLen;
    } catch (error) {
        logTC(`[cacheRawTweets] Error caching original tweet: ${error}`);
    }
    return 0;
}

export async function loadCachedTweetsByUserId(userId: string, limit = 10): Promise<WrapEntryObj[]> {
    return await databaseQueryByIndexRange(__tableCachedTweets, 'userId_timestamp_idx', [userId], limit) as WrapEntryObj[];
}

export async function initTweetsCheck(): Promise<boolean> {
    const count = await countTable(__tableCachedTweets);
    return count === 0
}

export async function loadLatestTweets(limit: number = 20,
                                       category: number | undefined = undefined,
                                       timeStamp: number | undefined = undefined) {
    let filterFn: ((row: any) => boolean) | undefined = undefined;

    if (category !== null) {
        const kols = await databaseQueryByFilter(__tableKolsInCategory, (item) => item.catID === category);
        const categoryUserIds = new Set<string>(kols.map(k => k.kolUserId));
        filterFn = (row) => categoryUserIds.has(row.userId);
    }

    return await databaseQueryByIndex(
        __tableCachedTweets,
        'timestamp_idx',
        limit,
        true,
        filterFn,
        timeStamp
    );
}


/**************************************************
 *
 *               content script api
 *
 * *************************************************/
export async function cacheTweetsToSW(kolId: string, rawTweets: WrapEntryObj[]): Promise<number> {
    const rsp = await sendMsgToService({
        kolId: kolId,
        data: rawTweets
    }, MsgType.TweetCacheToDB);
    if (!rsp.success || !rsp.data) return 0;
    return rsp.data as number
}

export async function needBootStrap(): Promise<boolean> {
    const rsp = await sendMsgToService({}, MsgType.TweetsBootStrap);
    if (!rsp.success) {
        console.warn("------>>> failed to check tweet bootstrap status!");
        return true;
    }

    return rsp.data as boolean;
}

export async function initBootstrapData() {

    for (let i = 0; i < initialKols.length; i++) {
        const kol = initialKols[i];
        const kolId = kol.kolUserId
        try {
            const r = await fetchTweets(kolId); // 首次获取 20 条
            const wrapList = r.wrapDbEntry;
            await sendMsgToService({kolId: kolId, data: r.wrapDbEntry}, MsgType.TweetCacheToDB);
            logTC(`Bootstrap cached ${wrapList.length} tweets for ${kolId}`);
            await sleep(3000);
        } catch (err) {
            logTC(`Bootstrap failed for  ${kolId}`, err);
        }
    }

}