import {Category, defaultUserName, MsgType, TweetKol} from "./consts";
import {
    __tableCategory,
    __tableKolsInCategory,
    databaseDelete, databaseGetByID,
    databaseQueryByFilter,
    databaseUpdate
} from "./database";
import {sendMsgToService} from "./utils";

export async function loadCategories(forUser: string): Promise<Category[]> {
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
}

export async function kolsForCategory(catID: number): Promise<Map<string, boolean>> {
    const kols = await databaseQueryByFilter(__tableKolsInCategory, (item) => {
        return item.categoryTyp === catID;
    });

    const kolInOneCategory = new Map<string, boolean>();
    for (const k of kols) {
        kolInOneCategory.set(k.kolName, true);
    }

    return kolInOneCategory;
}

export async function queryCategoriesFromBG(): Promise<Category[]> {
    const rsp = await sendMsgToService(defaultUserName, MsgType.QueryCatsByUser)
    if (!rsp.success) {
        console.log("------>>> load categories error:", rsp.data);
        return [];
    }
    return rsp.data as Category[];
}

export async function updateKolsCategory(kol: TweetKol) {
    try {
        await databaseUpdate(__tableKolsInCategory, kol.userName, kol)
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

export async function queryKolCategory(kolName: string): Promise<TweetKol | null> {
    try {
        const kol = await databaseGetByID(__tableKolsInCategory, kolName);
        return kol as TweetKol;
    } catch (e) {
        console.log("------>>> query kol failed:", kolName);
        return null;
    }
}