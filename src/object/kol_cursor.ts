import {__tableKolCursor, databasePutItem, databaseQueryAll} from "../common/database";
import {sendMsgToService} from "../common/utils";
import {MsgType} from "../common/consts";
import {logFT, logKC} from "../common/debug_flags";

export class KolCursor {
    userId: string;
    topCursor: string | null = null;
    bottomCursor: string | null = null;
    nextNewestFetchTime: number = 0
    private cacheEnough: boolean = false;
    private nextHistoryFetchTime: number = 0
    private failureCount: number = 0;

    private readonly LONG_WAIT_FOR_NEWEST = 20 * 60 * 1000; // 20分钟
    private readonly SHORT_WAIT_FOR_NEWEST = 1 * 60 * 1000; // 1分钟
    private readonly WAIT_FOR_HISTORY = 5 * 60 * 1000; // 5分钟
    private readonly MaxFailureTimes = 5; // 5分钟

    constructor(userId: string, topCursor: string | null = null, updateTime: number = 0) {
        this.userId = userId;
        this.topCursor = topCursor;
        this.nextNewestFetchTime = updateTime;
        logKC(`new cursor create userid=${userId} topCursor=${topCursor}`)
    }

    waitForNextNewestRound(topCursor: string | null, bottomCursor: string | null) {
        logKC(`[newest]⚠️ cursor before changed: top:[${this.topCursor}] bottom:[${this.bottomCursor}] failureCount:[${this.failureCount}] nextFetchTime:[${this.nextNewestFetchTime}]`)
        this.failureCount = 0;
        if (!this.bottomCursor) {
            this.bottomCursor = bottomCursor;
        }
        this.topCursor = topCursor;
        if (!topCursor) {
            this.nextNewestFetchTime = Date.now() + this.LONG_WAIT_FOR_NEWEST;
        } else {
            this.nextNewestFetchTime = Date.now() + this.SHORT_WAIT_FOR_NEWEST;
        }
        logKC(`[newest] ✅ cursor before changed: top:[${this.topCursor}] bottom:[${this.bottomCursor}] failureCount:[${this.failureCount}] nextFetchTime:[${this.nextNewestFetchTime}]`)
    }

    canFetchNew(): boolean {
        const now = Date.now();
        return now > this.nextNewestFetchTime && this.networkValid;
    }

    get networkValid(): boolean {
        return this.failureCount < this.MaxFailureTimes
    }

    updateBottom(nextCursor: string | null) {
        logKC(`[history]🌧️ cursor before changed:bottom:[${this.bottomCursor}] failureCount:[${this.failureCount}] nextFetchTime:[${this.nextHistoryFetchTime}]`)
        this.bottomCursor = nextCursor;
        this.failureCount = 0;
        if (nextCursor) {
            this.nextHistoryFetchTime = Date.now() + this.WAIT_FOR_HISTORY;
        }
        logKC(`[history] ☀️ cursor before changed:  bottom:[${this.bottomCursor}] failureCount:[${this.failureCount}] nextFetchTime:[${this.nextHistoryFetchTime}]`)
    }

    updateCacheStatus(cacheEnough: boolean) {
        this.cacheEnough = cacheEnough;
        logKC(`[cacheStatus] 🐼 cursor changed  cacheEnough:[${this.cacheEnough}] `)
    }

    needFetchOld(): boolean {
        const now = Date.now();
        return now >= this.nextHistoryFetchTime && !this.cacheEnough && null != this.bottomCursor && this.networkValid
    }

    markFailure() {
        this.failureCount++;
        logKC(`[failure]🐲 cursor changed failureCount:[${this.failureCount}] `)
    }

    static fromJSON(obj: any): KolCursor {
        return new KolCursor(obj.userId, obj.topCursor ?? null, obj.nextNewestFetchTime ?? 0);
    }

}

/**************************************************
 *
 *               service work api
 *
 * *************************************************/

export async function loadAllKolCursors() {
    return await databaseQueryAll(__tableKolCursor);
}

export async function writeKolsCursors(data: KolCursor[]) {
    for (const cursor of data) {
        await databasePutItem(__tableKolCursor, cursor);
    }
}

/**************************************************
 *
 *               content script api
 *
 * *************************************************/

export async function loadAllCursorFromSW(): Promise<Map<string, KolCursor>> {
    const result = new Map();
    const rsp = await sendMsgToService({}, MsgType.KolCursorLoadAll);
    if (!rsp.success || !rsp.data) {
        return result
    }
    const data = rsp.data as any[];
    for (const item of data) {
        const cursor = KolCursor.fromJSON(item); // 或你定义的反序列化方法
        result.set(cursor.userId, cursor);
    }
    return result
}

export async function saveKolCursorToSW(data: Map<string, KolCursor>) {
    await sendMsgToService(Array.from(data.values()), MsgType.KolCursorSaveAll);
}