export const __targetUrlToFilter = 'https://x.com/home';

export const defaultCategoryName = "Priority Follow"
export const maxElmFindTryTimes = 5;
export const DEFAULT_QUERY_ID = "RN-6zQ2Z3HC99_kSY5eTYg";
export const _db_key_query_id_ = "__db_key_query_id__"


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

