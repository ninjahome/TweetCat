
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
