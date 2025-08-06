import {EntryObj} from "./tweet_entry";
import pLimit from 'p-limit';

import {
    __tableCachedTweets, __tableCategory,
    __tableKolsInCategory,
    countTable, databaseDelete,
    databasePutItem, databaseQueryByFilter, databaseQueryByIndex,
    databaseQueryByIndexRange, idx_userid_time, pruneOldDataIfNeeded
} from "../common/database";
import {logTC} from "../common/debug_flags";
import {defaultCatID, defaultUserName} from "../common/consts";

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


export async function cacheRawTweets(kolId: string, rawTweets: WrapEntryObj[]) {
    const limit = pLimit(5);
    try {
        await Promise.all(
            rawTweets.map(obj => limit(() => databasePutItem(__tableCachedTweets, obj)))
        );
        const dataLen = await pruneOldDataIfNeeded(kolId, idx_userid_time, __tableCachedTweets, MAX_TWEETS_PER_KOL);
        logTC(`[cacheRawTweets] ✅ [${rawTweets.length}] tweets cached, [${dataLen}] old tweets deleted for kol[${kolId}]`);
    } catch (error) {
        logTC(`[cacheRawTweets] Error caching original tweet: ${error}`);
    }
}

export async function loadCachedTweetsByUserId(userId: string, limit = 10): Promise<WrapEntryObj[]> {
    return await databaseQueryByIndexRange(__tableCachedTweets, 'userId_timestamp_idx', [userId], limit) as WrapEntryObj[];
}

export async function initTweetsCheck(): Promise<{ bootStrap: boolean, data: any }> {
    const count = await countTable(__tableCachedTweets);
    if (count > 0) return {bootStrap: false, data: null};

    const categories = await databaseQueryByFilter(__tableCategory, (item) => {
        return item.forUser === defaultUserName;
    });

    let catID = defaultCatID;
    if (categories.length > 0) {
        catID = categories[0].id;
    }

    let counter = 0
    const kols = await databaseQueryByFilter(__tableKolsInCategory, (item) => {
        counter++;
        return item.catID === catID && counter <= 2;
    });

    return {bootStrap: true, data: kols};
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

    const tweets = await databaseQueryByIndex(
        __tableCachedTweets,
        'timestamp_idx',
        limit,
        true,
        filterFn,
        timeStamp
    );

    return tweets;
}
