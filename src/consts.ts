export const __targetUrlToFilter = 'https://x.com/home';

export const defaultCategoryName = "Priority Follow"
export const maxElmFindTryTimes = 5;
export const defaultUserName = 'default_v1';//TODO::for version 2,syncing data by user's tweet name
export const defaultAllCategoryID = -1;
export const maxMissedTweetOnce = 180;
export const itemColorGroup = ['#f6cd01', '#866afb', '#fe466c', '#06cbad', '#4592ef']
export const MaxCategorySize = 4;

function addOpacityToHex(hex: string, opacity: number): string {
    const clampedOpacity = Math.min(1, Math.max(0, opacity));
    const alpha = Math.round(clampedOpacity * 255).toString(16).padStart(2, '0');
    return `${hex}${alpha}`;
}

export function choseColorByID(id: number, opacity: number = 1): string {
    const baseColor = itemColorGroup[id % itemColorGroup.length];
    return addOpacityToHex(baseColor, opacity);
}

export const __DBK_Bearer_Token = "__DBK_Bearer_Token__";
export const DEFAULT_BEARER = "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
export const __DBK_query_id_map = "__DBK_query_id_map__";
export const __DBK_AD_Block_Key = "__DBK_AD_Block_Key";

export enum MsgType {
    OpenPlugin = 'OpenPlugin',
    NaviUrlChanged = 'NaviUrlChanged',
    QueryKolByCatID = 'QueryKolByCatID',
    QueryCatsByUser = 'QueryCatsByUser',
    CategoryChanged = 'CategoryChanged',
    QueryKolCat = 'QueryKolCat',
    UpdateKolCat = 'UpdateKolCat',
    QueryCatByID = 'QueryCatByID',
    RemoveKol = 'RemoveKol',
    AdsBlockChanged = 'AdsBlockChanged'
}

export class TweetKol {
    kolName: string;
    displayName: string;
    catID?: number;
    avatarUrl?: string;

    constructor(uName: string, dName: string, au?: string, cID?: number) {
        this.kolName = uName;
        this.displayName = dName;
        this.catID = cID;
        this.avatarUrl = au;
    }

    displayString(): string | null {
        if (!this.kolName || !this.displayName) {
            return null;
        }

        return this.displayName + "@" + this.kolName + "@" + (this.catID ?? "-1");
    }

    static FromString(str: string): TweetKol {
        return JSON.parse(str) as TweetKol;
    }
}

export class Category {
    id?: number;
    catName: string;
    forUser: string;

    constructor(n: string, u: string, i?: number) {
        this.catName = n;
        this.forUser = u;
        this.id = i;
    }
}
