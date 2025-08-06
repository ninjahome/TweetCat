import {__tableKolCursor, databasePutItem, databaseQueryAll} from "../common/database";
import {sendMsgToService} from "../common/utils";
import {MsgType} from "../common/consts";

export class KolCursor {

    userId: string;
    bottomCursor: string | null = null;
    topCursor: string | null = null;
    nextNewestFetchTime: number = 0
    nextHistoryFetchTime: number = 0
    cacheEnough: boolean = false;
    coolDownTime: number = 0;
    failureCount: number = 0;
    private readonly LONG_WAIT_FOR_NEWEST = 20 * 60 * 1000; // 20分钟
    private readonly SHORT_WAIT_FOR_NEWEST = 1 * 60 * 1000; // 1分钟
    private readonly WAIT_FOR_HISTORY = 5 * 60 * 1000; // 5分钟
    private readonly FETCH_COOL_DOWN = 2 * 60 * 1000; // 2分钟

    constructor(userId: string) {
        this.userId = userId;
    }

    waitForNextNewestRound(topCursor: string | null = null, bottomCursor: string | null = null, cacheEnough: boolean = false) {
        if (!topCursor) {
            this.nextNewestFetchTime = Date.now() + this.LONG_WAIT_FOR_NEWEST;
            return;
        }

        this.topCursor = topCursor;
        this.bottomCursor = bottomCursor;
        this.failureCount = 0;
        this.nextNewestFetchTime = Date.now() + this.SHORT_WAIT_FOR_NEWEST;
        this.cacheEnough = !bottomCursor || cacheEnough;
        this.coolDownTime = Date.now() + this.FETCH_COOL_DOWN;
    }

    canFetchNew(): boolean {
        const now = Date.now();
        return now >= this.coolDownTime && now > this.nextNewestFetchTime;
    }

    updateBottom(nextCursor: string | null = null, cacheEnough: boolean = false) {
        if (cacheEnough || !nextCursor) {
            this.cacheEnough = true;
            return;
        }
        this.bottomCursor = nextCursor;
        this.nextHistoryFetchTime = Date.now() + this.WAIT_FOR_HISTORY;
        this.coolDownTime = Date.now() + this.FETCH_COOL_DOWN;
    }

    needFetchOld(): boolean {
        const now = Date.now();
        return now >= this.coolDownTime && !this.cacheEnough && !this.bottomCursor
    }

    markFailure() {
        this.failureCount++;
        this.coolDownTime = Date.now() + this.failureCount * this.FETCH_COOL_DOWN;
    }

    static fromJSON(obj: any): KolCursor {
        const cursor = new KolCursor(obj.userId);
        cursor.bottomCursor = obj.bottomCursor ?? null;
        cursor.topCursor = obj.topCursor ?? null;
        cursor.nextNewestFetchTime = obj.nextNewestFetchTime ?? 0;
        cursor.nextHistoryFetchTime = obj.nextHistoryFetchTime ?? 0;
        cursor.cacheEnough = obj.cacheEnough ?? false;
        cursor.coolDownTime = obj.coolDownTime ?? 0;
        cursor.failureCount = obj.failureCount ?? 0;
        return cursor;
    }
}

export function debugKolCursor(cursor: KolCursor): string {
    const now = Date.now();

    function formatMs(ms: number) {
        const delta = ms - now;
        return delta <= 0 ? "ready" : `${Math.round(delta / 1000)}s`;
    }

    return `[KolCursor] ${cursor.userId}
  topCursor: ${cursor.topCursor ?? "null"}
  bottomCursor: ${cursor.bottomCursor ?? "null"}
  canFetchNew: ${cursor.canFetchNew()}
  needFetchOld: ${cursor.needFetchOld()}
  cacheEnough: ${cursor.cacheEnough}
  failureCount: ${cursor.failureCount}
  cooldown: ${formatMs(cursor.coolDownTime)}
  nextNewestFetchIn: ${formatMs(cursor.nextNewestFetchTime)}
  nextHistoryFetchIn: ${formatMs(cursor.nextHistoryFetchTime)}`;
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
    await sendMsgToService(Array.from(data.values()), MsgType.KolCursorLoadAll);
}