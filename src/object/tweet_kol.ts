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
 *               service work api
 *
 * *************************************************/
export async function loadAllKols(): Promise<any[]> {
    return await databaseQueryAll(__tableKolsInCategory);
}

export async function loadAllKolIds(): Promise<string[]> {
    const data = await databaseQueryAll(__tableKolsInCategory);
    return extractKolUserIds(data as any[])
}

export async function kolsForCategory(catID: number): Promise<Map<string, TweetKol>> {
    const kols = await databaseQueryByFilter(__tableKolsInCategory, (item) => {
        return item.catID === catID;
    });

    return dbObjectToKol(kols);
}

function dbObjectToKol(obj: any[]): Map<string, TweetKol> {
    return new Map(obj.map(k => [k.kolName, new TweetKol(k.kolName, k.displayName, k.avatarUrl, k.catID, k.kolUserId)]));
}

function dbObjectToKolArray(obj: any[]): TweetKol[] {
    return obj.map(k => new TweetKol(k.kolName, k.displayName, k.avatarUrl, k.catID, k.kolUserId));
}

function extractKolUserIds(obj: any[]): string[] {
    return obj
        .map(k => k.kolUserId)
        .filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
}

/**************************************************
 *
 *               content script api
 *
 * *************************************************/
export async function queryFilterFromBG(catID: number): Promise<Map<string, TweetKol>> {
    const rsp = await sendMsgToService(catID, MsgType.KolQueryByCategoryId)
    if (!rsp.success) {
        console.log("------>>> load filter error:", rsp.data);
        return new Map<string, TweetKol>();
    }
    return new Map(rsp.data);
}

export async function queryKolFromBG(): Promise<Map<string, TweetKol>> {
    const rsp = await sendMsgToService({}, MsgType.KolQueryAll);
    if (!rsp.success || !rsp.data) {
        console.warn("[TweetFetcher] Failed to load KOLs from service worker.");
        return new Map();
    }
    return dbObjectToKol(rsp.data as any[]);
}

export async function queryKolIdsFromSW(): Promise<string[]> {
    const rsp = await sendMsgToService({}, MsgType.KolQueryAll);
    if (!rsp.success || !rsp.data) {
        console.warn("[TweetFetcher] Failed to load KOLs from service worker.");
        return [];
    }
    return extractKolUserIds(rsp.data as any[])
}

export async function updateKolIdToSw(kol:any){
    await sendMsgToService(kol, MsgType.KolUpdate);
}
