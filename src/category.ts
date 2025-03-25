import {Category} from "./consts";
import {__tableCategory, __tableKolsInCategory, databaseQueryByFilter} from "./database";

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
