import {sendMsgToService} from "../common/utils";
import {MsgType} from "../common/consts";
import {
    __tableCategory,
    __tableKolsInCategory,
    databaseDelete,
    databaseDeleteByFilter,
    databaseGet, databaseQueryAll,
    databaseUpdate
} from "../common/database";
import {TweetKol} from "./tweet_kol";
import {clearCategoryForFollowings} from "./following";
import {SnapshotV1} from "../common/msg_obj";

export class Category {
    id?: number;
    catName: string;

    constructor(n: string, i?: number) {
        this.catName = n;
        this.id = i;
    }
}


/**************************************************
 *
 *             service work api
 *
 * *************************************************/

export async function loadCategories(): Promise<Category[]> {
    try {
        const categories = await databaseQueryAll(__tableCategory)
        let tmpCatArr: Category[] = []
        for (let i = 0; i < categories.length; i++) {
            const item = categories[i];
            const cat = new Category(item.catName, item.id);
            tmpCatArr.push(cat);
        }

        return [...tmpCatArr].sort((a, b) =>
            a.id! - b.id!//.localeCompare(b.catName)
        );
    } catch (e) {
        console.warn("------>>> load categories failed:", e)
        return []
    }
}

export async function CategoryForId(catID: number): Promise<Category | null> {
    try {
        return await databaseGet(__tableCategory, catID) as Category;
    } catch (e) {
        console.warn(`------>>> load categories by catID=[${catID}] failed:`, e)
        return null;
    }
}

export async function updateKolsCategory(kol: TweetKol) {
    try {
        await databaseUpdate(__tableKolsInCategory, 'kolName', kol.kolName, kol)
    } catch (e) {
        console.log("------>>> update kol failed:", kol);
    }
}

export async function removeKolsCategory(kolName: string) {
    try {
        await databaseDelete(__tableKolsInCategory, kolName);
    } catch (e) {
        console.log("------>>> remove kol failed:", kolName);
    }
}

export async function queryKolByName(kolName: string): Promise<TweetKol | null> {
    try {
        const kol = await databaseGet(__tableKolsInCategory, kolName);
        return kol as TweetKol;
    } catch (e) {
        console.log("------>>> query kol failed:", kolName);
        return null;
    }
}

export async function updateCategoryDetail(cat: Category) {
    try {
        await databaseUpdate(__tableCategory, 'id', cat.id, cat)
    } catch (e) {
        console.log("------>>> update category failed:", cat);
    }
}

export async function removeCategory(catID: number) {
    try {
        await databaseDelete(__tableCategory, catID);
        await databaseDeleteByFilter(__tableKolsInCategory, (item) => {
            return item.catID === catID;
        });
        await clearCategoryForFollowings(catID);
    } catch (e) {
        console.log("------>>> remove category failed:", catID);
    }
}

export async function loadCategorySnapshot(): Promise<SnapshotV1> {
    const catsRaw = await databaseQueryAll(__tableCategory);
    const categories = catsRaw
        .filter(item => typeof item.id === "number" && !!item.catName)
        .map(item => ({
            id: Number(item.id),
            name: String(item.catName)
        }));

    const kolRaw = await databaseQueryAll(__tableKolsInCategory);

    const assignments = kolRaw
        .filter(item => item && typeof item.catID === "number")
        .map(item => ({
            screenName: item.kolName,
            userId: item.kolUserId,
            categoryId: Number(item.catID),
        }));

    const snapshot: SnapshotV1 = {
        version: 1,
        createdAt: new Date().toISOString(),
        categories,
        assignments,
    };

    return snapshot;
}


/**************************************************
 *
 *               content script api
 *
 * *************************************************/
export async function queryCategoriesFromBG(): Promise<Category[]> {
    const rsp = await sendMsgToService({}, MsgType.CategoryQueryAll)
    if (!rsp.success) {
        console.log("------>>> load categories error:", rsp.data);
        return [];
    }
    // console.log("------------------------->>>tmp ", rsp)
    return rsp.data as Category[];
}

export async function queryCategoryById(catID: number): Promise<Category | null> {
    const rsp = await sendMsgToService(catID, MsgType.CategoryQueryById)
    if (!rsp.success) {
        console.log("------>>> load categories error:", rsp.data);
        return null;
    }
    // console.log("------------------------->>>tmp ", rsp)
    return rsp.data as Category;
}

export type KolCategoryMapEntry = {
    kolName: string;
    displayName?: string;
    avatarUrl?: string;
    kolUserId?: string;
    catID?: number | null;
};

export async function queryAllKolCategoryMapFromBG(): Promise<Map<string, KolCategoryMapEntry>> {
    const rsp = await sendMsgToService({}, MsgType.KolQueryAll);
    if (!rsp.success || !Array.isArray(rsp.data)) {
        console.warn("------>>> load kol categories error:", rsp.data);
        return new Map();
    }

    const map = new Map<string, KolCategoryMapEntry>();
    for (const item of rsp.data as any[]) {
        if (!item || !item.kolName) continue;
        const key = String(item.kolName).toLowerCase();
        const rawCatId = item.catID;
        const catID = rawCatId === null || rawCatId === undefined ? null : Number(rawCatId);
        map.set(key, {
            kolName: item.kolName,
            displayName: item.displayName,
            avatarUrl: item.avatarUrl,
            kolUserId: item.kolUserId,
            catID,
        });
    }
    return map;
}

export async function assignKolsToCategoryFromBG(
    keys: string[],
    targetCatId: number,
    snapshots?: Map<string, KolCategoryMapEntry>,
): Promise<void> {
    if (keys.length === 0) return;
    const updates = keys.map((rawKey) => {
        const key = rawKey.toLowerCase();
        const snapshot = snapshots?.get(key);
        const kolName = snapshot?.kolName ?? rawKey;
        return sendMsgToService(
            {
                kolName,
                displayName: snapshot?.displayName ?? kolName,
                avatarUrl: snapshot?.avatarUrl,
                kolUserId: snapshot?.kolUserId,
                catID: targetCatId,
            },
            MsgType.KolUpdate,
        );
    });

    const results = await Promise.all(updates);
    const failed = results.find((rsp) => !rsp?.success);
    if (failed) {
        throw new Error(failed?.data ?? "Failed to assign KOL category.");
    }
}

export async function removeKolsFromCategoryFromBG(kolNames: string[]): Promise<void> {
    const unique = Array.from(new Set(kolNames.filter((name) => !!name)));
    if (unique.length === 0) return;
    const results = await Promise.all(unique.map((name) => sendMsgToService(name, MsgType.KolRemove)));
    const failed = results.find((rsp) => !rsp?.success);
    if (failed) {
        throw new Error(failed?.data ?? "Failed to remove KOL from category.");
    }
}