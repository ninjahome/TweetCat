import browser from "webextension-polyfill";

const storage = browser.storage;

/**
 * 设置 local 存储中的键值对
 */
export async function localSet(key: string, value: any): Promise<void> {
    try {
        await storage.local.set({ [key]: value });
        // console.log(`[local storage] set key=${key} success.`);
    } catch (error: unknown) {
        const err = error as Error;
        console.error(`[local storage] Failed to set key=${key}:`, err);
    }
}

/**
 * 获取 local 存储中的值
 */
export async function localGet(key: string): Promise<any> {
    try {
        const result = await storage.local.get(key);
        return result[key];
    } catch (error: unknown) {
        const err = error as Error;
        console.error(`[local storage] Failed to get key=${key}:`, err);
        return null;
    }
}

/**
 * 删除 local 存储中的键
 */
export async function localRemove(key: string): Promise<void> {
    try {
        await storage.local.remove(key);
        // console.log(`[local storage] remove key=${key} success.`);
    } catch (error: unknown) {
        console.error(`[local storage] Failed to remove key=${key}:`, error);
    }
}

/**
 * 清空 local 存储
 */
export async function resetLocal(): Promise<void> {
    try {
        await storage.local.clear();
        // console.log("[local storage] cleared.");
    } catch (error: unknown) {
        const err = error as Error;
        console.error("[local storage] Failed to clear:", err);
    }
}
