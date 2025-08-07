import {__tableKolCursor, databasePutItem, databaseQueryAll} from "../common/database";
import {sendMsgToService} from "../common/utils";
import {MsgType} from "../common/consts";
import {logKC} from "../common/debug_flags";

export class KolCursor {
    userId: string;
    topCursor: string | null = null;
    bottomCursor: string | null = null;
    nextNewestFetchTime: number = 0
    cacheEnough: boolean = false;
    nextHistoryFetchTime: number = 0
    failureCount: number = 0;

    private static readonly LONG_WAIT_FOR_NEWEST = 20 * 60 * 1000; //
    private static readonly SHORT_WAIT_FOR_NEWEST = 40 * 1000; //
    private static readonly WAIT_FOR_HISTORY = 5 * 60 * 1000; //
    private static readonly MaxFailureTimes = 5; // 5次

    constructor(userId: string) {
        this.userId = userId;
        logKC(`new cursor create userid=${userId}`)
    }

    waitForNextNewestRound(topCursor: string | null, bottomCursor: string | null) {
        logKC(`[newest]⚠️ cursor before changed: top:[${this.topCursor}] bottom:[${this.bottomCursor}] failureCount:[${this.failureCount}] nextFetchTime:[${this.nextNewestFetchTime}]`)
        this.failureCount = 0;
        if (!this.bottomCursor) {
            this.bottomCursor = bottomCursor;
        }
        this.topCursor = topCursor;
        if (!topCursor) {
            this.nextNewestFetchTime = Date.now() + KolCursor.LONG_WAIT_FOR_NEWEST;
        } else {
            this.nextNewestFetchTime = Date.now() + KolCursor.SHORT_WAIT_FOR_NEWEST;
        }
        logKC(`[newest] ✅ cursor before changed: top:[${this.topCursor}] bottom:[${this.bottomCursor}] failureCount:[${this.failureCount}] nextFetchTime:[${this.nextNewestFetchTime}]`)
    }

    canFetchNew(): boolean {
        const now = Date.now();
        return now > this.nextNewestFetchTime && this.networkValid;
    }

    get networkValid(): boolean {
        return this.failureCount < KolCursor.MaxFailureTimes
    }

    updateBottom(nextCursor: string | null) {
        logKC(`[history]🌧️ cursor before changed:bottom:[${this.bottomCursor}] failureCount:[${this.failureCount}] nextFetchTime:[${this.nextHistoryFetchTime}]`)
        this.bottomCursor = nextCursor;
        this.failureCount = 0;
        if (nextCursor) {
            this.nextHistoryFetchTime = Date.now() + KolCursor.WAIT_FOR_HISTORY;
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
        const instance = new KolCursor(obj.userId);
        instance.topCursor =  obj.topCursor ?? null;
        instance.bottomCursor =  obj.bottomCursor ?? null;
        instance.nextNewestFetchTime =  obj.nextNewestFetchTime ?? 0;
        instance.cacheEnough =  obj.nextNewestFetchTime ?? false;
        instance.nextHistoryFetchTime =  obj.nextHistoryFetchTime ?? 0;
        instance.failureCount =  obj.failureCount ?? 0;
        return instance;
    }

    markAsBootstrap() {
        this.failureCount = 0;
        this.bottomCursor = null;
        this.cacheEnough = false;
        this.nextHistoryFetchTime = 0;
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