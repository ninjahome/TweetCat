export const __targetUrlToFilter = 'https://x.com/home';

export const defaultCategoryName = "Priority Follow"
export const maxElmFindTryTimes = 5;
export const defaultUserName = 'default_v1';//TODO::for version 2,syncing data by user's tweet name

export enum MsgType {
    OpenPlugin = 'OpenPlugin',
    InitPopup = "InitPopup",
    NewCategoryItem = 'NewCategoryItem',
    NewCategoryType = 'NewCategoryType',
    NaviUrlChanged = 'NaviUrlChanged',
}

export class TweetKol {
    userName: string;
    displayName: string;

    constructor(uName: string, dName: string) {
        this.userName = uName;
        this.displayName = dName;
    }

    nameVal(): string | null {
        if (!this.userName || !this.displayName) {
            return null;
        }
        return this.displayName + "@" + this.userName;
    }
}

export class Category {
    id: number;
    name: string;

    constructor(i: number, n: string) {
        this.id = i;
        this.name = n;
    }
}