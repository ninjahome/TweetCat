import {Category, defaultUserName} from "./consts";
import {__tableCategory, __tableKolsInCategory, databaseQueryByFilter} from "./database";

let _curCategories: Category[] = [];
let _curActiveCatId = 0;
const _kolMap = new Map<number, Map<string, boolean>>();

export async function initKolAndCatCache() {

    const categories = await databaseQueryByFilter(__tableCategory, (item) => {
        return item.forUser === defaultUserName;//TODO::user will be dynamic in version 2
    })

    console.log("------>>> current categories:", __tableKolsInCategory, categories);

    _curCategories.length = 0;
    let tmpCatArr: Category[] = []
    for (let i = 0; i < categories.length; i++) {
        const item = categories[i];
        const cat = new Category(item.catName, item.forUser, item.id);
        tmpCatArr.push(cat);

        const kols = await databaseQueryByFilter(__tableKolsInCategory, (item) => {
            return item.categoryTyp === cat.id;
        });

        const kolInOneCategory = new Map<string, boolean>();
        for (const k of kols) {
            kolInOneCategory.set(k.kolName, true);
        }

        _kolMap.set(cat.id!, kolInOneCategory);
    }
    _curCategories = [...tmpCatArr].sort((a, b) =>
        a.catName.localeCompare(b.catName)
    );

    console.log("------>>> current kol map:", _kolMap);
}

export function kolsInActiveCategory(): Map<string, boolean> | null {
    if (_curActiveCatId < 1) {
        return null;
    }

    return _kolMap.get(_curActiveCatId) ?? null;
}

export function kolsForCatId(catID: number): Map<string, boolean> | null {
    if (catID < 1) {
        return null;
    }

    return _kolMap.get(catID) ?? null;
}

export function setCurrentCategory(category: number) {
    _curActiveCatId = category;
}

export function curCategories(): Category[] {
    return _curCategories;
}

export function newCategoryCached(item:Category){
    _curCategories.push(item);
    _curCategories = [..._curCategories].sort((a, b) =>
        a.catName.localeCompare(b.catName)
    );
}