export const __targetUrlToFilter = 'https://x.com/home';

export const defaultCategoryName = "Priority Follow"

export enum MsgType {
    OpenPlugin = 'OpenPlugin',
    InitPopup = "InitPopup",
    NewCategoryItem = 'NewCategoryItem',
    NewCategoryType = 'NewCategoryType',
    NaviUrlChanged = 'NaviUrlChanged'
}

export class TweetUser {
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