import {buildSyntheticItemFromModule, EntryObj} from "./tweet_entry";
import pLimit from 'p-limit';

import {
    __tableCachedTweets,
    __tableKolsInCategory, countTable, databaseDeleteByIndexValue,
    databaseUpdateOrAddItem,
    databaseQueryByFilter,
    databaseQueryByIndex,
    databaseQueryByIndexRange, idx_tweets_userid,
    idx_tweets_user_time, initialKols,
    pruneOldDataIfNeeded, databaseQueryByTimeAndUserKeyFiltered, idx_tweets_time, databaseGet
} from "../common/database";
import {logTC} from "../common/debug_flags";
import {sendMsgToService, sleep} from "../common/utils";
import {MsgType} from "../common/consts";
import {fetchTweets} from "./twitter_api";

const MAX_TWEETS_PER_KOL = 200;

export class WrapEntryObj {
    tweetId: string;
    userId: string;
    timestamp: number;
    rawJson: any;
    isConversation: boolean = false

    constructor(entryId: string, userId: string, timestamp: number, rawJson: any, isConversation: boolean) {
        this.tweetId = entryId;
        this.userId = userId;
        this.timestamp = timestamp;
        this.rawJson = rawJson;
        this.isConversation = isConversation;
    }

    static fromEntryObj(entry: EntryObj, rawJson: any, isConversation: boolean = false): WrapEntryObj {
        return new WrapEntryObj(
            entry.entryId,
            entry.tweet.author.authorID,
            new Date(entry.tweet.tweetContent.created_at).getTime(),
            rawJson,
            isConversation
        );
    }

    static toEntryObj(data: WrapEntryObj): EntryObj {
        const raw = data.rawJson;
        const entryType = raw?.content?.entryType ?? raw?.entryType;

        if (entryType === 'TimelineTimelineModule') {
            const syntheticItem = buildSyntheticItemFromModule(raw)
            if (!syntheticItem) {
                throw new Error('TimelineTimelineModule contains no tweet items');
            }
            return new EntryObj(syntheticItem);
        }

        // 非模块：保持现有行为
        return new EntryObj(raw);
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
            rawTweets.map(obj => limit(() => databaseUpdateOrAddItem(__tableCachedTweets, obj)))
        );
        const dataLen = await pruneOldDataIfNeeded(kolId, idx_tweets_user_time, __tableCachedTweets, MAX_TWEETS_PER_KOL);
        logTC(`[cacheRawTweets] ✅ [${rawTweets.length}] tweets cached, [${dataLen}] old tweets deleted for kol[${kolId}]`);
        return dataLen;
    } catch (error) {
        logTC(`[cacheRawTweets] Error caching original tweet: ${error}`);
    }
    return 0;
}

export async function updateBookmarked(tweetId: string, value: boolean): Promise<boolean> {
    try {
        // 1) 从表里获取该 tweet
        const obj = await databaseGet(__tableCachedTweets, tweetId) as WrapEntryObj;
        if (!obj) {
            console.warn(`❌ 未找到 tweetId=${tweetId} 的缓存记录`);
            return false;
        }

        // 2) 修改 rawJson.legacy.bookmarked
        const tweet = obj.rawJson?.content?.itemContent?.tweet_results?.result;
        if (tweet?.legacy) {
            tweet.legacy.bookmarked = value;
        } else {
            console.warn(`⚠️ tweetId=${tweetId} 没有 legacy 字段`);
            return false;
        }

        // 3) 覆盖写回数据库
        await databaseUpdateOrAddItem(__tableCachedTweets, obj);

        console.log(`✅ 已更新 tweetId=${tweetId} 的 bookmarked=${value}`);
        return true;
    } catch (err) {
        console.error("❌ 更新 bookmarked 失败:", err);
        return false;
    }
}

export async function loadCachedTweetsByUserId(userId: string, limit = 10): Promise<WrapEntryObj[]> {
    return await databaseQueryByIndexRange(__tableCachedTweets, 'userId_timestamp_idx', [userId], limit) as WrapEntryObj[];
}

export async function initTweetsCheck(): Promise<boolean> {
    const count = await countTable(__tableCachedTweets);
    return count === 0
}


export async function loadLatestTweets(
    limit: number = 20,
    category: number,
    timeStamp?: number
) {
    if (category >= 0) {
        const kols = await databaseQueryByFilter(__tableKolsInCategory, (item) => item.catID === category);
        const categoryUserIds = new Set<string>(kols.map(k => String(k.kolUserId)));

        // ✅ 用“键层过滤”的高效查询（仍是全局时间线，绝不重复）
        return databaseQueryByTimeAndUserKeyFiltered(
            __tableCachedTweets,
            limit,
            categoryUserIds,
            timeStamp
        );
    }

    // 非分类：沿用原来的索引
    return databaseQueryByIndex(
        __tableCachedTweets,
        idx_tweets_time,
        limit,
        true,
        undefined,
        timeStamp
    );
}

export async function removeTweetsByKolID(kolID: string) {
    const deletedNo = await databaseDeleteByIndexValue(__tableCachedTweets, idx_tweets_userid, kolID);
    logTC(`[removeTweetsByKolID] remove ${deletedNo} tweets for kol: ${kolID}`);
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
