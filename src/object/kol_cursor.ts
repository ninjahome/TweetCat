import {__tableKolCursor, databasePutItem, databaseQueryAll} from "../common/database";
import {sendMsgToService} from "../common/utils";
import {MsgType} from "../common/consts";

export class KolCursor {
    userId: string;
    bottomCursor: string | null = null;
    topCursor: string | null = null;
    isEnd: boolean = false;
    latestFetchedAt: number | null = null;
    nextEligibleFetchTime: number = 0;
    failureCount: number = 0;

    private readonly FETCH_COOL_DOWN = 20 * 60 * 1000; // 20分钟
    private readonly MIN_KOL_FETCH_INTERVAL = 15 * 60 * 1000; // 每个 KOL 最小间隔 15 分钟

    constructor(userId: string) {
        this.userId = userId;
    }

    reset() {
        this.bottomCursor = null;
        this.topCursor = null;
        this.isEnd = false;
        this.latestFetchedAt = null;
        this.failureCount = 0;
        this.setNextFetchAfter(this.MIN_KOL_FETCH_INTERVAL);
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

    markFailure() {
        this.failureCount++;
        const backoff = this.failureCount * this.FETCH_COOL_DOWN;
        this.setNextFetchAfter(backoff);
    }

    resetFailureCount() {
        this.failureCount = 0;
        this.setNextFetchAfter(this.MIN_KOL_FETCH_INTERVAL);
    }

    setNextFetchAfter(ms: number) {
        this.nextEligibleFetchTime = Date.now() + ms;
    }

    canFetch(): boolean {
        return Date.now() >= this.nextEligibleFetchTime && !this.isEnd;
    }

    static fromJSON(obj: any): KolCursor {
        const cursor = new KolCursor(obj.userId);
        cursor.bottomCursor = obj.bottomCursor ?? null;
        cursor.topCursor = obj.topCursor ?? null;
        cursor.isEnd = obj.isEnd ?? false;
        cursor.latestFetchedAt = obj.latestFetchedAt ?? null;
        cursor.nextEligibleFetchTime = obj.nextEligibleFetchTime ?? 0;
        cursor.failureCount = obj.failureCount ?? 0;
        return cursor;
    }
}

export function debugKolCursor(cursor: KolCursor): string {
    const now = Date.now();
    const status = cursor.isEnd
        ? "🔚 ended"
        : now < cursor.nextEligibleFetchTime
            ? "⏸ cooling down"
            : "✅ ready";

    const nextIn = Math.max(0, cursor.nextEligibleFetchTime - now);
    const nextSec = Math.round(nextIn / 1000);

    const lastFetchedStr = cursor.latestFetchedAt
        ? new Date(cursor.latestFetchedAt).toISOString()
        : "never";

    const nextEligibleStr = new Date(cursor.nextEligibleFetchTime).toISOString();

    return `[KolCursor] ${cursor.userId}
  status: ${status}
  failureCount: ${cursor.failureCount}
  nextFetchIn: ${nextSec}s (${nextEligibleStr})
  latestFetchedAt: ${lastFetchedStr}
  bottomCursor: ${cursor.bottomCursor ?? "null"}
  topCursor: ${cursor.topCursor ?? "null"}
  isEnd: ${cursor.isEnd}`;
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

export async function loadAllKolFromSW(): Promise<Map<string, KolCursor>> {
    const result = new Map();
    const rsp = await sendMsgToService({}, MsgType.DBReadTAllKolCursor);
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

export async function saveKolCursorToSW(data: KolCursor[]) {
    await sendMsgToService(data, MsgType.DBReadTAllKolCursor);
}