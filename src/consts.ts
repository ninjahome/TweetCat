export const __targetUrlToFilter = 'https://x.com/home';

export const defaultCategoryName = "Priority Follow"
export const maxElmFindTryTimes = 5;
export const defaultUserName = 'default_v1';//TODO::for version 2,syncing data by user's tweet name
export const defaultAllCategoryID = -1;
export const itemColorGroup = ['#f6cd01', '#866afb', '#fe466c', '#06cbad', '#4592ef']

export enum MsgType {
    OpenPlugin = 'OpenPlugin',
    InitPopup = "InitPopup",
    NaviUrlChanged = 'NaviUrlChanged',
    QueryKolByCatID = 'QueryKolByCatID',
    QueryCatsByUser = 'QueryCatsByUser',
    CategoryChanged = 'CategoryChanged',
    QueryKolCat = 'QueryKolCat',
    UpdateKolCat = 'UpdateKolCat',
    RemoveKol = 'RemoveKol'
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
