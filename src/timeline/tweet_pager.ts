/* ------------------------------------------------------------------ *
 * Tweet Pager State
 * ------------------------------------------------------------------ */
import {EntryObj} from "./tweet_entry";
import {logFT, logPager} from "../common/debug_flags";
import {sendMsgToService} from "../common/utils";
import {defaultAllCategoryID, MsgType} from "../common/consts";
import {initBootstrapData, needBootStrap, WrapEntryObj} from "./db_raw_tweet";
import {fetchTweets} from "./twitter_api";
import {BossOfTheTwitter} from "../common/database";
import {KolCursor} from "../object/kol_cursor";
import {startToFetchTweets} from "./tweet_fetcher";
import {tweetFetchParam} from "../common/msg_obj";


export class TweetPager {
    private timeStamp?: number;
    private currentCategoryId: number = defaultAllCategoryID;

    constructor() {
    }

    switchCategory(newCategoryId: number = defaultAllCategoryID) {
        this.resetPager();
        this.currentCategoryId = newCategoryId;
        logPager(`[switchCategory] category changed -> ${newCategoryId}, timeStamp=${this.timeStamp}`);
    }

    async getNextTweets(pageSize: number): Promise<EntryObj[]> {
        const rsp = await sendMsgToService({
            limit: pageSize,
            category: this.currentCategoryId,
            timeStamp: this.timeStamp
        }, MsgType.TweetReadByCategoryId);
        if (!rsp.success || !rsp.data) {
            console.warn("------>>> failed to switchCategory!");
            return [];
        }

        const rawData = rsp.data as WrapEntryObj[];
        if (rawData.length === 0) {
            console.warn("------>>> no data when switchCategory!");//TOOD::fetcher
            return this.findNewestTweetsOfSomeBody();
        }

        const tweets = unwrapEntryObj(rawData);
        const lastOne = rawData[rawData.length - 1];
        this.timeStamp = lastOne.timestamp;

        if (tweets.length < pageSize) {
            console.warn(`[getNextTweets] not enough data to show!`)//TODO::
        }

        logPager(`[getNextTweets] category:[${this.currentCategoryId}], timeStamp[${this.timeStamp}] load tweets=${tweets.length}`);
        return tweets;
    }

    /** 强制重置所有状态，恢复初始 */
    resetPager() {
        this.timeStamp = undefined;
        this.currentCategoryId = defaultAllCategoryID;
        logPager('[Pager] HARD RESET completed.');
    }

    async init() {
        const bootStrap = await needBootStrap();
        if (bootStrap) {
            await initBootstrapData();
            logPager("✅Initial tweet cache already populated, skipping bootstrap");
            return;
        }

        const needSrvData = needServerDataForFirstOpen();
        if (!needSrvData) return;
        fetchNewestAtFirstOpen().then();
    }

    //TODO::
    async findNewestTweetsOfSomeBody(): Promise<EntryObj[]> {
        const result = await fetchTweets(BossOfTheTwitter);
        return result.tweets ?? []
    }
}

function unwrapEntryObj(rawData: WrapEntryObj[]): EntryObj[] {
    return rawData.map(row => WrapEntryObj.fromDbRow(row).toEntryObj());
}

export const tweetPager = new TweetPager();
document.addEventListener('DOMContentLoaded', function onLoadOnce() {
    tweetPager.init().then(() => {
        logFT('[TweetPager] 🚀 DOMContentLoaded: init checking for first tweet loading');
    });
    document.removeEventListener('DOMContentLoaded', onLoadOnce);
});


const FIRST_FETCH_TS_KEY = 'tc:firstFetchAt';
const FIRST_FETCH_TTL_MS = 30 * 60 * 1000;

function getFirstFetchAt(): number | null {
    const raw = localStorage.getItem(FIRST_FETCH_TS_KEY);
    if (!raw) return null;
    const n = Number(raw);
    logFT('[getFirstFetchAt] 🚀 last time to fetch data:', fmt(n));
    return Number.isFinite(n) ? n : null;
}

export function setLatestFetchAt(ts: number) {
    localStorage.setItem(FIRST_FETCH_TS_KEY, String(ts));
}

function needServerDataForFirstOpen(ttlMs: number = FIRST_FETCH_TTL_MS): boolean {
    const now = Date.now();
    const firstAt = getFirstFetchAt();
    if (firstAt === null) return true;
    return (now - firstAt) >= ttlMs;
}

function fmt(ts: number) {
    try {
        return new Date(ts).toISOString();
    } catch {
        return String(ts);
    }
}

async function fetchNewestAtFirstOpen() {

    logPager("⚠️Need load data form server for first open of twitter");
    const rsp = await sendMsgToService({}, MsgType.KolCursorForFirstOpen);
    if (!rsp.success || !rsp.data) {
        console.warn("------>>>⚠️failed to low newest kol cursor ");
        return
    }

    const param = new tweetFetchParam(rsp.data as KolCursor[], true);
    await startToFetchTweets(param);
    logPager("✅ finish tweets fetching at first open twitter page");
}

(window as any).tcResetFirstFetch = () => localStorage.removeItem(FIRST_FETCH_TS_KEY);