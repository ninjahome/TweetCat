import browser from "webextension-polyfill";
import {logBGT} from "../common/debug_flags";
import {loadAllKolIds} from "../object/tweet_kol";
import {KolCursor, loadAllKolCursors, loadCursorById, loadCursorsForKols} from "../object/kol_cursor";
import {sendMessageToX} from "./bg_msg";
import {MsgType} from "../common/consts";

export class tweetFetchParam {
    cursors: KolCursor[];
    newest: boolean

    constructor(cursors: KolCursor[], newest: boolean = true) {
        this.cursors = cursors;
        this.newest = newest;
    }
}

interface TweetFetcherRuntimeState {
    currentNewGroupIndex: number;
    currentOldGroupIndex: number;
    newestFetch: boolean;
    bootStrap: boolean;
    immediateQueue: string[];
}

export class TweetFetcherManager {
    private currentNewGroupIndex = 0;
    private currentOldGroupIndex = 0;
    private newestFetch = false;
    private bootStrap = true;
    private immediateQueue: string[] = [];

    private readonly MAX_KOL_PER_ROUND = 5;
    private readonly KOL_SCAN_LIMIT = this.MAX_KOL_PER_ROUND * 3;
    private readonly STORAGE_KEY = '__tweet_fetcher_runtime_state__';

    constructor() {
    }

    async loadRuntimeStateFromStorage() {
        const result = await browser.storage.local.get(this.STORAGE_KEY);
        const state = result[this.STORAGE_KEY] as Partial<TweetFetcherRuntimeState> ?? {};

        this.currentNewGroupIndex = state.currentNewGroupIndex ?? 0;
        this.currentOldGroupIndex = state.currentOldGroupIndex ?? 0;
        this.newestFetch = state.newestFetch ?? false;
        this.bootStrap = state.bootStrap ?? true;
        this.immediateQueue = state.immediateQueue ?? [];

        logBGT("[loadRuntimeStateFromStorage]✅ State has been loaded:", JSON.stringify(state));
    }

    async saveRuntimeStateToStorage() {
        const state: TweetFetcherRuntimeState = {
            currentNewGroupIndex: this.currentNewGroupIndex,
            currentOldGroupIndex: this.currentOldGroupIndex,
            newestFetch: this.newestFetch,
            bootStrap: this.bootStrap,
            immediateQueue: this.immediateQueue,
        };

        await browser.storage.local.set({
            [this.STORAGE_KEY]: state
        });
        logBGT("[saveRuntimeStateToStorage]⚠️ State has been saved:", JSON.stringify(state));
    }

    async resetState(): Promise<void> {
        this.currentNewGroupIndex = 0;
        this.currentOldGroupIndex = 0;
        this.newestFetch = true;
        this.bootStrap = true;
        this.immediateQueue = [];

        await this.saveRuntimeStateToStorage();
        logBGT("[resetState]🔴 State has been reset on browser startup");
    }

    private async loadKolCursors(ids: string[] = []): Promise<Map<string, KolCursor>> {
        const kolCursorMap = new Map<string, KolCursor>();
        let data: any[]
        if (ids.length === 0) data = await loadAllKolCursors();
        else data = await loadCursorsForKols(ids);
        for (const item of data) {
            const cursor = KolCursor.fromJSON(item); // 或你定义的反序列化方法
            if (this.bootStrap) {
                cursor.markAsBootstrap();
            }
            kolCursorMap.set(cursor.userId, cursor);
        }
        return kolCursorMap;
    }

    private async getNextKolGroup(newest: boolean = true): Promise<KolCursor[]> {

        const kolIds = await loadAllKolIds();

        const total = kolIds.length;
        if (total === 0) return [];

        const result: KolCursor[] = [];
        const maxScan = Math.min(this.KOL_SCAN_LIMIT, total);
        let scanCount = 0;
        let found = 0;

        let idx = newest ? this.currentNewGroupIndex : this.currentOldGroupIndex;

        while (scanCount < maxScan && found < this.MAX_KOL_PER_ROUND) {
            const userId = kolIds[idx % total];
            const cursor = await loadCursorById(userId) ?? new KolCursor(userId);
            const canUse = newest ? cursor.canFetchNew() : cursor.needFetchOld();
            if (canUse) {
                result.push(cursor);
                found++;
            } else {
                logBGT("[getNextKolGroup]🔴Kol can't used:", JSON.stringify(cursor));
            }
            scanCount++;
            idx++;
            if (idx % total === 0 && this.bootStrap) {
                this.bootStrap = false;
            }
        }

        if (newest) {
            this.currentNewGroupIndex = idx % total;
        } else {
            this.currentOldGroupIndex = idx % total;
        }

        return result;
    }

    async getNormalCursors(): Promise<KolCursor[]> {
        if (this.bootStrap) {
            this.newestFetch = true;
            this.bootStrap = false;
        } else {
            this.newestFetch = !this.newestFetch;
        }

        let newest = this.newestFetch;

        let groupKolCursors = await this.getNextKolGroup(newest);
        if (groupKolCursors.length === 0) {
            logBGT(`[fetchTweetsPeriodic] 😅  ${newest ? "[Newest]" : "[History]"} round ${newest ? this.currentNewGroupIndex : this.currentOldGroupIndex} no kol ids`);
            return [];
        }
        return groupKolCursors;
    }

    async getImmediateCursors(): Promise<KolCursor[]> {
        const immediateCursors: KolCursor[] = [];

        // 限制数量
        const limit = Math.min(this.immediateQueue.length, this.MAX_KOL_PER_ROUND);

        for (let i = 0; i < limit; i++) {
            const userId = this.immediateQueue.shift()!; // 从队列头取出并移除
            const cursor = await loadCursorById(userId) ?? new KolCursor(userId);
            immediateCursors.push(cursor);
        }

        return immediateCursors;
    }


    async fetchTweetsPeriodic() {
        let cursorToFetch: KolCursor[];
        let newest: boolean;
        if (this.immediateQueue.length > 0) {
            logBGT(`[fetchTweetsPeriodic]Need to fetch immediate queue[${this.immediateQueue.length}] first`);
            cursorToFetch = await this.getImmediateCursors();
            newest = true;
        } else {
            cursorToFetch = await this.getNormalCursors();
            newest = this.newestFetch;
        }

        const param = new tweetFetchParam(cursorToFetch, newest);
        const sendSuccess = await sendMessageToX(MsgType.StartTweetsFetch, param)
        if (!sendSuccess) {
            logBGT(`[fetchTweetsPeriodic] 😭 send fetch message failed   ${newest ? "[Newest]" : "[History]"} round ${newest ? this.currentNewGroupIndex : this.currentOldGroupIndex}`);
            return
        }
        logBGT(`[fetchTweetsPeriodic] ♻️ Starting ${newest ? "[Newest]" : "[History]"} round ${newest ? this.currentNewGroupIndex : this.currentOldGroupIndex} at ${new Date().toISOString()}`);
    }

    async queuePush(kolID: string) {
        logBGT(`[queuePush] ♻️ New kol ${kolID} need to push in immediate queue`);
        await this.loadRuntimeStateFromStorage()
        this.immediateQueue.push(kolID);
        await this.saveRuntimeStateToStorage();
    }
}


export async function checkIfXIsOpen(): Promise<boolean> {
    const tabs = await browser.tabs.query({
        url: "*://x.com/*"
    });

    return tabs.length > 0;
}