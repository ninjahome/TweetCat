import {Category, defaultUserName, MsgType, TweetKol} from "./consts";
import {
    __tableCategory,
    __tableKolsInCategory,
    databaseDelete, databaseDeleteByFilter, databaseGet,
    databaseQueryByFilter,
    databaseUpdate
} from "./database";
import {sendMsgToService} from "./utils";

export async function loadCategories(forUser: string): Promise<Category[]> {
    try {
        const categories = await databaseQueryByFilter(__tableCategory, (item) => {
            return item.forUser === forUser;
        })
        let tmpCatArr: Category[] = []
        for (let i = 0; i < categories.length; i++) {
            const item = categories[i];
            const cat = new Category(item.catName, item.forUser, item.id);
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
        console.log("------>>> load categories failed:", e)
        return null;
    }
}

export async function kolsForCategory(catID: number): Promise<Map<string, TweetKol>> {
    const kols = await databaseQueryByFilter(__tableKolsInCategory, (item) => {
        return item.catID === catID;
    });

    const kolInOneCategory = new Map<string, TweetKol>();
    for (const k of kols) {
        kolInOneCategory.set(k.kolName, new TweetKol(k.kolName, k.displayName, k.avatarUrl, k.catID));
    }

    return kolInOneCategory;
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
    } catch (e) {
        console.log("------>>> remove category failed:", catID);
    }
}


/**************************************************
 *
 *              service work api
 *
 * *************************************************/
export async function queryCategoriesFromBG(): Promise<Category[]> {
    const rsp = await sendMsgToService(defaultUserName, MsgType.QueryCatsByUser)
    if (!rsp.success) {
        console.log("------>>> load categories error:", rsp.data);
        return [];
    }
    // console.log("------------------------->>>tmp ", rsp)
    return rsp.data as Category[];
}

export async function queryCategoryById(catID: number): Promise<Category | null> {
    const rsp = await sendMsgToService(catID, MsgType.QueryCatByID)
    if (!rsp.success) {
        console.log("------>>> load categories error:", rsp.data);
        return null;
    }
    // console.log("------------------------->>>tmp ", rsp)
    return rsp.data as Category;
}