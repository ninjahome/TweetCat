import browser from "webextension-polyfill";
import {logBGT} from "../common/debug_flags";
import {loadAllKolIds} from "../object/tweet_kol";
import {KolCursor, loadAllKolCursors} from "../object/kol_cursor";
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
}

export class TweetFetcherManager {
    private currentNewGroupIndex = 0;
    private currentOldGroupIndex = 0;
    private newestFetch = false;
    private bootStrap = true;

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

        logBGT("[loadRuntimeStateFromStorage]✅ State has been loaded:", JSON.stringify(state));
    }

    async saveRuntimeStateToStorage() {
        const state: TweetFetcherRuntimeState = {
            currentNewGroupIndex: this.currentNewGroupIndex,
            currentOldGroupIndex: this.currentOldGroupIndex,
            newestFetch: this.newestFetch,
            bootStrap: this.bootStrap
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

        await this.saveRuntimeStateToStorage();
        logBGT("[resetState]🔴 State has been reset on browser startup");
    }


    private async getNextKolGroup(newest: boolean = true): Promise<KolCursor[]> {

        const kolIds = await loadAllKolIds();
        const kolCursorMap = new Map<string, KolCursor>();
        const data = await loadAllKolCursors();
        for (const item of data) {
            const cursor = KolCursor.fromJSON(item); // 或你定义的反序列化方法
            if (this.bootStrap) {
                cursor.markAsBootstrap();
            }
            kolCursorMap.set(cursor.userId, cursor);
        }

        const total = kolIds.length;
        if (total === 0) return [];

        const result: KolCursor[] = [];
        const maxScan = Math.min(this.KOL_SCAN_LIMIT, total);
        let scanCount = 0;
        let found = 0;

        let idx = newest ? this.currentNewGroupIndex : this.currentOldGroupIndex;

        while (scanCount < maxScan && found < this.MAX_KOL_PER_ROUND) {
            const userId = kolIds[idx % total];
            const cursor = kolCursorMap.get(userId) ?? new KolCursor(userId);
            const canUse = newest ? cursor.canFetchNew() : cursor.needFetchOld();
            if (canUse) {
                result.push(cursor);
                found++;
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

    async fetchTweetsPeriodic() {
        if (this.bootStrap) {
            this.newestFetch = true;
            this.bootStrap = false;
        } else {
            this.newestFetch = !this.newestFetch;
        }

        let newest = this.newestFetch;

        const groupKolCursors = await this.getNextKolGroup(newest);
        if (groupKolCursors.length === 0) {
            logBGT(`[fetchTweetsPeriodic] 😅  ${newest ? "[Newest]" : "[History]"} round ${newest ? this.currentNewGroupIndex : this.currentOldGroupIndex} no kol ids`);
            return;
        }

        const param = new tweetFetchParam(groupKolCursors, newest);
        const sendSuccess = await sendMessageToX(MsgType.StartTweetsFetch, param)
        if (!sendSuccess) {
            logBGT(`[fetchTweetsPeriodic] 😭 send fetch message failed   ${newest ? "[Newest]" : "[History]"} round ${newest ? this.currentNewGroupIndex : this.currentOldGroupIndex}`);
            return
        }
        logBGT(`[fetchTweetsPeriodic] ♻️ Starting ${newest ? "[Newest]" : "[History]"} round ${newest ? this.currentNewGroupIndex : this.currentOldGroupIndex} at ${new Date().toISOString()}`);
    }
}


export async function checkIfXIsOpen(): Promise<boolean> {
    const tabs = await browser.tabs.query({
        url: "*://x.com/*"
    });

    return tabs.length > 0;
}