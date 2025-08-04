import {EntryObj} from "./tweet_entry";
import {__tableCachedTweets, databasePutItem, databaseQueryByIndexRange} from "../database";
import {logTC} from "../debug_flags";

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

export async function cacheRawTweets(rawTweets: WrapEntryObj[]) {
    try {
        for (let i = 0; i < rawTweets.length; i++) {
            const wrapObj = rawTweets[i];
            await databasePutItem(__tableCachedTweets, wrapObj);
            logTC(`[fetchTweets] Original tweet cached successfully: ${wrapObj.tweetId}`);
        }
    } catch (error) {
        logTC(`[fetchTweets] Error caching original tweet: ${error}`);
    }
}

export async function loadCachedTweetsByUserId(userId: string, limit = 10): Promise<WrapEntryObj[]> {
    return await databaseQueryByIndexRange(__tableCachedTweets, 'userId_timestamp_idx', [userId], limit) as WrapEntryObj[];
}