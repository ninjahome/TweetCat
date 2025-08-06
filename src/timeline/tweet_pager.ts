/* ------------------------------------------------------------------ *
 * Tweet Pager State
 * ------------------------------------------------------------------ */
import {EntryObj} from "./tweet_entry";
import {logPager} from "../common/debug_flags";
import {fetchTweets} from "./twitter_api";
import {sendMsgToService} from "../common/utils";
import {MsgType} from "../common/consts";
import {BossOfTheWholeWorld} from "../common/database";
import {WrapEntryObj} from "./db_raw_tweet";
import {tweetFetcher} from "./tweet_fetcher";


export class TweetPager {
    private timeStamp?: number;
    private currentCategoryId: number | null = null;

    constructor() {
    }

    switchCategory(newCategoryId: number | null = null) {
        this.resetPager();
        this.currentCategoryId = newCategoryId;
        logPager(`[switchCategory] category changed -> ${newCategoryId}, timeStamp=${this.timeStamp}`);
    }

    async getNextTweets(pageSize: number): Promise<EntryObj[]> {
        const rsp = await sendMsgToService({
            limit: pageSize,
            category: this.currentCategoryId,
            timeStamp: this.timeStamp
        }, MsgType.DBReadTweetByCategoryId);
        if (!rsp.success || !rsp.data) {
            console.warn("------>>> failed to switchCategory!");
            return [];
        }

        const rawData = rsp.data as WrapEntryObj[];
        if (rawData.length === 0) {
            console.warn("------>>> no data when switchCategory!");//TOOD::fetcher
            return tweetFetcher.findHistoryTweets();
        }

        const tweets = unwrapEntryObj(rawData);
        const lastOne = rawData[rawData.length - 1];
        this.timeStamp = lastOne.timestamp;

        if (tweets.length < pageSize) {
            logPager(`[getNextTweets] not enough data to show!`)//TODO::
        }

        logPager(`[getNextTweets] category:[${this.currentCategoryId}], timeStamp[${this.timeStamp}] load tweets=${tweets.length}`);
        return tweets;
    }

    /** 强制重置所有状态，恢复初始 */
    resetPager() {
        this.timeStamp = undefined;
        logPager('[Pager] HARD RESET completed.');
    }

    private async bootstrap() {
        const rsp = await sendMsgToService({}, MsgType.TweetsBootStrap);
        if (!rsp.success) {
            console.warn("------>>> failed to check tweet bootstrap status!");
            return;
        }

        const {bootStrap, data} = rsp.data;

        if (!bootStrap) {
            logPager("Initial tweet cache already populated, skipping bootstrap");
            return;
        }

        try {
            const r = await fetchTweets(BossOfTheWholeWorld, 20, undefined); // 首次获取 20 条
            const wrapList = r.wrapDbEntry;
            await sendMsgToService({kolId: BossOfTheWholeWorld, data: r.wrapDbEntry}, MsgType.CacheRawTweetData);
            logPager(`Bootstrap cached ${wrapList.length} tweets for boss`);
        } catch (err) {
            logPager(`Bootstrap failed for boss`, err);
        }
    }

    async init() {
        await this.bootstrap();
    }
}

function unwrapEntryObj(rawData: WrapEntryObj[]): EntryObj[] {
    return rawData.map(row => WrapEntryObj.fromDbRow(row).toEntryObj());
}

export const tweetPager = new TweetPager();

