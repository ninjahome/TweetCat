import browser from "webextension-polyfill";

const storage = browser.storage;

export async function sessionSet(key: string, value: any): Promise<void> {
    try {
        await storage.session.set({[key]: value});
        // console.log(`[service work] set value for key=${key} successfully.`);
    } catch (error: unknown) {
        const err = error as Error;
        console.error(`[session service] Failed to set  key=${key} value:`, err);
    }
}
export async function resetStorage(){
    await storage.session.clear();
}

export async function sessionGet(key: string): Promise<any> {
    try {
        const result = await storage.session.get(key);
        // console.log(`[service work] get value for key=${key} successfully.`);
        return result[key];
    } catch (error: unknown) {
        const err = error as Error;
        console.error(`[session service] Failed to get value for key=${key} :`, err);
        return null;
    }
}

export async function sessionRemove(key: string): Promise<void> {
    try {
        await storage.session.remove(key);
        // console.log(`[service work] Value for key=${key} was removed successfully.`);
    } catch (error) {
        console.error("[session service] Failed to remove value:", error);
    }
}
