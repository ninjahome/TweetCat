import {
    __tableFollowings,
    checkAndInitDatabase,
    databaseDeleteByFilter,
    databaseQueryAll,
    databaseQueryByFilter,
    databaseUpdateFields,
    databaseUpdateOrAddItem
} from "../common/database";
import {fetchFollowingPage, getUserByUsername} from "../timeline/twitter_api";
import {sleep} from "../common/utils";
import {logFM} from "../common/debug_flags";

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

export async function syncFollowingsFromPage(): Promise<FollowingUser[]> {
    const screenName = await resolveViewerScreenName();
    if (!screenName) {
        throw new Error('Unable to determine current user. Please open your Twitter profile.');
    }

    const profile = await getUserByUsername(screenName);
    const userId = profile?.userId;
    if (!userId) {
        throw new Error('Failed to resolve user id for current account.');
    }

    const collected: FollowingUser[] = [];
    const visited = new Set<string>();
    let cursor: string | undefined = undefined;
    let pageCount = 0;

    while (true) {
        const page = await fetchFollowingPage(userId, 100, cursor);
        for (const user of page.users) {
            if (visited.has(user.userID)) continue;
            visited.add(user.userID);
            const raw = user.rawData ?? {};
            const legacy = raw?.legacy ?? {};
            const profileBio = raw?.profile_bio ?? {};
            const locationObj = raw?.location ?? {};
            const bioCandidate = typeof legacy?.description === "string" && legacy.description.trim().length > 0
                ? legacy.description
                : typeof profileBio?.description?.text === "string" && profileBio.description.text.trim().length > 0
                    ? profileBio.description.text
                    : undefined;
            const locationCandidate = typeof legacy?.location === "string" && legacy.location.trim().length > 0
                ? legacy.location
                : typeof locationObj?.location === "string" && locationObj.location.trim().length > 0
                    ? locationObj.location
                    : undefined;
            const followersCount = typeof legacy?.followers_count === "number" ? legacy.followers_count : undefined;
            const friendsCount = typeof legacy?.friends_count === "number" ? legacy.friends_count : undefined;
            const statusesCount = typeof legacy?.statuses_count === "number" ? legacy.statuses_count : undefined;
            collected.push({
                id: user.userID,
                name: user.name,
                screenName: user.screen_name,
                avatarUrl: user.avatarUrl,
                bio: bioCandidate,
                location: locationCandidate,
                followersCount,
                friendsCount,
                statusesCount,
            });
        }

        if (!page.nextCursor || page.terminatedBottom) {
            break;
        }

        cursor = page.nextCursor;
        pageCount += 1;
        if (pageCount > 200) { // safety guard
            console.warn('------>>> Following sync reached page limit, stopping early.');
            break;
        }
        await sleep(350); // avoid hitting rate limits
    }

    return collected;
}

async function resolveViewerScreenName(maxRetries: number = 10): Promise<string | null> {
    for (let i = 0; i < maxRetries; i++) {
        const profileLink = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]') as HTMLAnchorElement | null;
        if (profileLink?.href) {
            try {
                const url = new URL(profileLink.href);
                const username = url.pathname.replace(/^\//, '').trim();
                if (username) {
                    return username;
                }
            } catch {
                // ignore parse errors
            }
        }
        await sleep(500);
    }
    return null;
}


/**
 * 批量从本地数据库中删除已取消关注的账号
 * @param userIds 要删除的用户 ID 列表
 * @returns 删除结果 { success, removed, error? }
 */
export async function removeLocalFollowings(userIds: string[]): Promise<{
    success: boolean;
    removed?: number;
    error?: string;
}> {
    try {
        if (!Array.isArray(userIds) || userIds.length === 0) {
            return {success: false, error: "No userIds provided"};
        }
        const normalizedIds = userIds.map(String);
        logFM("[removeLocalFollowings] 🧩 incoming userIds:", userIds, "normalizedIds:, normalizedIds");
        let matchedCount = 0;
        await databaseDeleteByFilter(__tableFollowings, (row) => {
            const hit = normalizedIds.includes(String(row.id));
            if (hit) {
                matchedCount++;
                logFM("[removeLocalFollowings] ✅ match", row.id, typeof row.id);
            }
            return hit;
        });

        logFM(`[removeLocalFollowings] ✅ matched ${matchedCount} of ${normalizedIds.length}`);

        return {success: true, removed: normalizedIds.length};
    } catch (err) {
        console.error("[removeLocalFollowings] ❌ Failed:", err);
        return {success: false, error: String(err)};
    }
}

