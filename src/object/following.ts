import {__tableFollowings, checkAndInitDatabase, databaseDeleteByFilter, databaseQueryAll, databaseQueryByFilter, databaseUpdateFields, databaseUpdateOrAddItem} from "../common/database";

export interface FollowingUser {
    id: string;
    name: string;
    screenName: string;
    avatarUrl: string;
    categoryId?: number | null;
    lastSyncedAt?: number;
    bio?: string;
    location?: string;
    followersCount?: number;
    friendsCount?: number;
    statusesCount?: number;
}

export async function loadAllFollowings(): Promise<FollowingUser[]> {
    await checkAndInitDatabase();
    const data = await databaseQueryAll(__tableFollowings) as FollowingUser[];
    return data ?? [];
}

export async function loadFollowingsByCategory(categoryId: number | null): Promise<FollowingUser[]> {
    await checkAndInitDatabase();
    if (categoryId === null) {
        return await databaseQueryByFilter(__tableFollowings, (item) => !item.categoryId) as FollowingUser[];
    }
    return await databaseQueryByFilter(__tableFollowings, (item) => item.categoryId === categoryId) as FollowingUser[];
}

export async function replaceFollowingsPreservingCategories(users: FollowingUser[]): Promise<void> {
    await checkAndInitDatabase();
    const existing = await loadAllFollowings();
    const categoryMap = new Map<string, number | null | undefined>();
    for (const item of existing) {
        categoryMap.set(item.id, item.categoryId);
    }
    const timestamp = Date.now();
    await databaseDeleteByFilter(__tableFollowings, () => true);
    for (const user of users) {
        const categoryId = categoryMap.has(user.id) ? categoryMap.get(user.id)! : user.categoryId ?? null;
        await databaseUpdateOrAddItem(__tableFollowings, {
            ...user,
            categoryId,
            lastSyncedAt: timestamp,
        });
    }
}

export async function assignFollowingsToCategory(userIds: string[], categoryId: number | null): Promise<void> {
    if (userIds.length === 0) return;
    await checkAndInitDatabase();
    const targetCategory = categoryId ?? null;
    await Promise.all(userIds.map((id) => databaseUpdateFields(__tableFollowings, id, {categoryId: targetCategory})));
}

export async function clearCategoryForFollowings(catId: number): Promise<void> {
    await checkAndInitDatabase();
    const matches = await databaseQueryByFilter(__tableFollowings, (item) => item.categoryId === catId) as FollowingUser[];
    await Promise.all(matches.map((item) => databaseUpdateFields(__tableFollowings, item.id, {categoryId: null})));
}

export async function hasFollowingsData(): Promise<boolean> {
    const list = await loadAllFollowings();
    return list.length > 0;
}
