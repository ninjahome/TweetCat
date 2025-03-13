import {defaultCategoryName} from "./consts";

export function getCategoryKeys(): string[] {
    return [...__categoryMap.keys()];
}

const __categoryMap = new Map<string, Map<string, boolean>>();
let __currentCategory: string | null = null;

export function loadCategoriesFromDB() {
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