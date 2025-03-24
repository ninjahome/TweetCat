import {defaultCategoryName} from "./consts";

export function getCategoryKeys(): string[] {
    return [...__categoryMap.keys()];
}

const __categoryMap = new Map<string, Map<string, boolean>>();
let __currentCategory: string | null = null;

export async function loadCategoriesFromDB(userName:string) {
    const defaultCategory = new Map();
    defaultCategory.set("elonmusk", true);
    __categoryMap.set(defaultCategoryName, defaultCategory);
}

export function activeCategory(): Map<string, boolean> | null {
    if (!__currentCategory) {
        return null;
    }

    return __categoryMap.get(__currentCategory) ?? null;
}

export function setCurrentCategory(category: string | null) {
    __currentCategory = category;
}

export function currentCategory():string|null{
    return  __currentCategory;
}

async function loadLastUserName():Promise<string | null>{
    return "BMailService@TweetCatOrg";
}

export async function loadLastCategoriesFromDB():Promise<string[]|null> {
    const userName = await loadLastUserName();
    if (!userName) {
        return null;
    }

    await  loadCategoriesFromDB(userName);

    return getCategoryKeys();
}