export const __targetUrlToFilter = 'https://x.com/home';

export const defaultCategoryName = "Priority Follow"
export const maxElmFindTryTimes = 5;
export const defaultUserName = 'default_v1';//TODO::for version 2,syncing data by user's tweet name

export const itemColorGroup = ['#f6cd01', '#866afb', '#fe466c', '#06cbad', '#4592ef']

export enum MsgType {
    OpenPlugin = 'OpenPlugin',
    InitPopup = "InitPopup",
    NaviUrlChanged = 'NaviUrlChanged',
    QueryKolByCatID = 'QueryKolByCatID',
    QueryCatsByUser = 'QueryCatsByUser',
    NewCategoryAdd = 'NewCategoryAdd',
    QueryKolCat = 'QueryKolCat',
    UpdateKolCat = 'UpdateKolCat',
    RemoveKol = 'RemoveKol'
}

export class TweetKol {
    userName: string;
    displayName: string;
    catID?: number;

    constructor(uName: string, dName: string, cID?: number) {
        this.userName = uName;
        this.displayName = dName;
        this.catID = cID;
    }

    displayString(): string | null {
        if (!this.userName || !this.displayName) {
            return null;
        }

        return this.displayName + "@" + this.userName + "@" + (this.catID ?? "-1");
    }

    static FromString(str:string):TweetKol{
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

export class KolFilterKey {
    kolName: string;

    constructor(kn: string) {
        this.kolName = kn;
    }
}