import {Category, defaultUserName, TweetKol} from "./consts";
import {__tableCategory, __tableKolsInCategory, databaseQueryByFilter} from "./database";

let _curCategories:Category[] = [];
let _curActiveCatId = 0;
const _kolMap = new Map<number, Map<string, boolean>>();

export async function initKolAndCatCache() {

    const categories = await databaseQueryByFilter(__tableCategory, (item) => {
        return item.forUser === defaultUserName;//TODO::user will be dynamic in version 2
    })

    console.log("------>>> current categories:",categories);

    _curCategories.length = 0;
    for (let i = 0; i < categories.length; i++) {
        const item = categories[i];
        const cat = new Category(item.id, item.category);
        _curCategories.push(cat);

        const kols = await databaseQueryByFilter(__tableKolsInCategory, (item) => {
            return item.categoryTyp === cat.id;
        });

        const kolInOneCategory = new Map<string, boolean>();
        for (const k of kols) {
            kolInOneCategory.set(k.kolName,true);
        }

        _kolMap.set(cat.id, kolInOneCategory);
    }

    console.log("------>>> current kol map:",_kolMap);
}

export function kolsInActiveCategory(): Map<string, boolean> | null {
    if (_curActiveCatId<1) {
        return null;
    }

    return _kolMap.get(_curActiveCatId) ?? null;
}

export function setCurrentCategory(category: number) {
    _curActiveCatId = category;
}

// export function currentCategory() {
//     const found = numbers.find((num) => num > 2);
//     return __currentCategory;
// }

export function curCategories(): Category[] {
    return _curCategories;
}
