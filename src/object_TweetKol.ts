
export class TweetKol {
    kolName: string;
    displayName: string;
    kolUserId?:string;
    catID?: number;
    avatarUrl?: string;

    constructor(uName: string, dName: string, au?: string, cID?: number, kid?:string) {
        this.kolName = uName;
        this.displayName = dName;
        this.catID = cID;
        this.avatarUrl = au;
        this.kolUserId = kid;
    }

    displayString(): string | null {
        if (!this.kolName || !this.displayName) {
            return null;
        }

        return this.displayName + "@" + this.kolName + "@" + (this.catID ?? "-1");
    }
}
