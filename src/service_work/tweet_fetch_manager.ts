import browser from "webextension-polyfill";
import {logBGT} from "../common/debug_flags";
import {loadAllKolIds} from "../object/tweet_kol";
import {KolCursor, loadCursorById} from "../object/kol_cursor";
import {sendMessageToX} from "./bg_msg";
import {MsgType} from "../common/consts";
import {tweetFetchParam} from "../common/msg_obj";

interface TweetFetcherRuntimeState {
    currentNewGroupIndex: number;
    currentOldGroupIndex: number;
    newestFetch: boolean;
    immediateQueue: string[];
}

export class TweetFetcherManager {
    private currentNewGroupIndex = 0;
    private currentOldGroupIndex = 0;
    private newestFetch = false;
    private immediateQueue: string[] = [];

    readonly MAX_KOL_PER_ROUND = 5;
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
        this.immediateQueue = state.immediateQueue ?? [];

        logBGT("[loadRuntimeStateFromStorage]✅ State has been loaded:", JSON.stringify(state));
    }

    async saveRuntimeStateToStorage() {
        const state: TweetFetcherRuntimeState = {
            currentNewGroupIndex: this.currentNewGroupIndex,
            currentOldGroupIndex: this.currentOldGroupIndex,
            newestFetch: this.newestFetch,
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
        this.immediateQueue = [];

        await this.saveRuntimeStateToStorage();
        logBGT("[resetState]🔴 State has been reset on browser startup");
    }

    public async getNextKolGroup(newest: boolean = true): Promise<KolCursor[]> {

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
            // console.log('--------------------->>> kol id to query:', userId);
            const cursorData = await loadCursorById(userId);
            let cursor: KolCursor | null = null;
            if (!cursorData) {
                cursor = new KolCursor(userId);
            } else {
                cursor = KolCursor.fromJSON(cursorData);
            }
            const canUse = newest ? cursor.canFetchNew() : cursor.needFetchOld();
            if (canUse) {
                result.push(cursor);
                found++;
            } else {
                logBGT("[getNextKolGroup]🔴Kol can't used:", JSON.stringify(cursor));
            }
            scanCount++;
            idx++;
        }

        if (newest) {
            this.currentNewGroupIndex = idx % total;
        } else {
            this.currentOldGroupIndex = idx % total;
        }

        return result;
    }

    async getImmediateCursors(): Promise<KolCursor[]> {
        const immediateCursors: KolCursor[] = [];

        // 限制数量
        const limit = Math.min(this.immediateQueue.length, this.MAX_KOL_PER_ROUND);

        for (let i = 0; i < limit; i++) {
            const userId = this.immediateQueue.shift()!; // 从队列头取出并移除
            const cursorData = await loadCursorById(userId);
            let cursor: KolCursor | null = null;
            if (!cursorData) {
                cursor = new KolCursor(userId);
            } else {
                cursor = KolCursor.fromJSON(cursorData);
            }
            immediateCursors.push(cursor);
        }

        return immediateCursors;
    }

    async fetchTweetsPeriodic() {
        let newest: boolean;
        let cursorToFetch: KolCursor[];
        if (this.immediateQueue.length > 0) {
            logBGT(`[fetchTweetsPeriodic]Need to fetch immediate queue[${this.immediateQueue.length}] first`);
            cursorToFetch = await this.getImmediateCursors();
            newest = true;
        } else {
            cursorToFetch = await this.getNextKolGroup(this.newestFetch);
            // cursorToFetch = await this.getNextKolGroup(true);
            newest = this.newestFetch;
            this.newestFetch = !this.newestFetch;
        }

        if (cursorToFetch.length === 0) {
            logBGT(`[fetchTweetsPeriodic] 😅  ${newest ? "[Newest]" : "[History]"} round ${newest ? this.currentNewGroupIndex : this.currentOldGroupIndex} no kol ids`);
            return;
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
        await this.loadRuntimeStateFromStorage();

        // 去重：如果已存在则不重复加入
        if (!this.immediateQueue.includes(kolID)) {
            this.immediateQueue.push(kolID);
            await this.saveRuntimeStateToStorage();
        } else {
            logBGT(`[queuePush] 🚫 kol ${kolID} already in immediate queue, skip`);
        }
    }

    async removeFromImmediateQueue(kid: string) {
        await this.loadRuntimeStateFromStorage();
        this.immediateQueue = this.immediateQueue.filter(id => id !== kid);
        await this.saveRuntimeStateToStorage();
    }
}

export const tweetFM = new TweetFetcherManager();
