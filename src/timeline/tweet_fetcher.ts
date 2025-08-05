import {fetchTweets} from "./twitter_api";
import {sendMsgToService, sleep} from "../common/utils";
import {logFT} from "../common/debug_flags";
import {MsgType} from "../common/consts";

class KolCursor {
    userId: string;
    bottomCursor: string | null = null;
    topCursor: string | null = null;
    isEnd: boolean = false;
    latestFetchedAt: number | null = null;

    constructor(userId: string) {
        this.userId = userId;
    }

    reset() {
        this.bottomCursor = null;
        this.topCursor = null;
        this.isEnd = false;
        this.latestFetchedAt = null;
    }

    markEnd() {
        this.isEnd = true;
    }

    updateBottom(cursor: string | null) {
        this.bottomCursor = cursor;
        if (!cursor) this.isEnd = true;
    }

    updateTop(cursor: string | null) {
        this.topCursor = cursor;
    }
}


export class TweetFetcher {
    private intervalId: number | null = null;
    private readonly FETCH_INTERVAL_MS = 60_000; // 每 60 秒轮询一次
    private readonly FETCH_LIMIT = 20;
    private kolCursors: Map<string, KolCursor> = new Map();
    private kolIds: [] = [];

    constructor() {
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

        this.intervalId = window.setInterval(() => {
            this.fetchAllKols();
        }, this.FETCH_INTERVAL_MS);
    }

    stop() {
        if (this.intervalId !== null) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }

    private async loadKolIds(){

    }

    private async fetchAllKols() {
        const kolIds = this.kolIds;

        for (const userId of kolIds) {
            const cursor = this.getKolCursor(userId);
            if (!cursor || cursor.isEnd) continue;

            try {
                const result = await fetchTweets(userId, this.FETCH_LIMIT, cursor.bottomCursor ?? undefined);
                const tweets = result.tweets ?? [];

                if (tweets.length > 0) {
                    await sendMsgToService(result.wrapDbEntry, MsgType.CacheRawTweetData);
                    cursor.updateBottom(result.nextCursor ?? null);
                }

                if (tweets.length === 0 || !result.nextCursor) {
                    cursor.markEnd();
                }

                logFT(`${userId} fetched ${tweets.length} tweets`);

            } catch (err) {
                let msg = '';
                if (err && typeof err === 'object' && 'message' in err) {
                    msg = String((err as any).message);
                }

                if (msg.includes('429') || msg.includes('Rate limit exceeded')) {
                    console.warn(`[Fetcher] 429 Rate limit hit for user ${userId}, delaying next fetch`);
                    return;
                }
                console.warn(`[Fetcher] failed to fetch for user ${userId}`, err);
            }

            await sleep(1000);
        }
    }

    private findNewestTweet() {

    }
}

export const tweetFetcher = new TweetFetcher();
