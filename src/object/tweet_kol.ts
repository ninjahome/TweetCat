import {sendMsgToService} from "../common/utils";
import {MsgType} from "../common/consts";
import {__tableKolsInCategory, databaseQueryAll, databaseQueryByFilter} from "../common/database";

export class TweetKol {
    kolName: string;
    displayName: string;
    kolUserId?: string;
    catID?: number;
    avatarUrl?: string;

    constructor(uName: string, dName: string, au?: string, cID?: number, kid?: string) {
        this.kolName = uName;
        this.displayName = dName;
        this.catID = cID;
        this.avatarUrl = au;
        this.kolUserId = kid;
    }

    displayString(): string {
        return JSON.stringify(this);
    }
}

/**************************************************
 *
 *               content script api
 *
 * *************************************************/
export async function queryFilterFromBG(catID: number): Promise<Map<string, TweetKol>> {
    const rsp = await sendMsgToService(catID, MsgType.QueryKolByCatID)
    if (!rsp.success) {
        console.log("------>>> load filter error:", rsp.data);
        return new Map<string, TweetKol>();
    }
    return new Map(rsp.data);
}


/**************************************************
 *
 *               service work api
 *
 * *************************************************/
export async function loadAllKols(): Promise<any[]> {
    return await databaseQueryAll(__tableKolsInCategory);
}


export async function kolsForCategory(catID: number): Promise<Map<string, TweetKol>> {
    const kols = await databaseQueryByFilter(__tableKolsInCategory, (item) => {
        return item.catID === catID;
    });

    // const kolInOneCategory = new Map<string, TweetKol>();
    // for (const k of kols) {
    //     kolInOneCategory.set(k.kolName, new TweetKol(k.kolName, k.displayName, k.avatarUrl, k.catID, k.kolUserId));
    // }

    return dbObjectToKol(kols);
}

export function dbObjectToKol(obj: any[]): Map<string, TweetKol> {
    return new Map(obj.map(k => [k.kolName, new TweetKol(k.kolName, k.displayName, k.avatarUrl, k.catID, k.kolUserId)]));
}

