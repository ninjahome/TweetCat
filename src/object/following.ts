import {
    __tableFollowings,
    checkAndInitDatabase,
    databaseDeleteByFilter,
    databaseQueryAll,
    databaseQueryByFilter,
    databaseUpdateFields,
    databaseUpdateOrAddItem
} from "../common/database";
import {fetchFollowingPage, getUserByUsername, unfollowUser} from "../timeline/twitter_api";
import {sleep} from "../common/utils";
import {logFM} from "../common/debug_flags";

export interface FollowingUser {
    userId: string;
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
        categoryMap.set(item.userId, item.categoryId);
    }
    const timestamp = Date.now();
    await databaseDeleteByFilter(__tableFollowings, () => true);
    for (const user of users) {
        const categoryId = categoryMap.has(user.userId) ? categoryMap.get(user.userId)! : user.categoryId ?? null;
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
    await Promise.all(matches.map((item) => databaseUpdateFields(__tableFollowings, item.userId, {categoryId: null})));
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
                userId: user.userID,
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

/**
 * 从 Twitter API 拉取单个用户信息，并转换为 FollowingUser 结构返回。
 * 注意：此函数不进行数据库写入，结果由 popup 或 background 处理。
 */
export async function syncOneFollowingsByScreenName(screenName?: string): Promise<FollowingUser> {
    if (!screenName || !screenName.trim()) {
        throw new Error("screenName is required");
    }

    // 1️⃣ 获取用户档案
    const userProfile = await getUserByUsername(screenName.trim());
    if (!userProfile) {
        throw new Error(`Failed to fetch profile for @${screenName}`);
    }

    return {
        userId: userProfile.userId,
        name: userProfile.displayName || userProfile.userName || screenName,
        screenName: userProfile.userName || screenName,
        avatarUrl: userProfile.avatar || "",
        categoryId: null,
        lastSyncedAt: Date.now(),

        // 以下字段从 UserProfile 映射
        bio: userProfile.hasDescription ? "" : undefined, // 若需要真实简介可后续补入
        location: undefined, // UserProfile 没有位置信息，可在 getUserByUsername 内扩展
        followersCount: userProfile.followersCount,
        friendsCount: userProfile.friendsCount,
        statusesCount: userProfile.statusesCount,
    };
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
        logFM("[removeLocalFollowings] 🧩 incoming userIds:", userIds, "normalizedIds:",normalizedIds);
        let matchedCount = 0;
        await databaseDeleteByFilter(__tableFollowings, (row) => {
            const hit = normalizedIds.includes(String(row.userId));
            if (hit) {
                matchedCount++;
                logFM("[removeLocalFollowings] ✅ match", row.userId, typeof row.userId);
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


const RATE_LIMIT_BACKOFF_MS = 5_000;
const RATE_LIMIT_CODE_REGEX = /"code"\s*:\s*(\d+)/i;

function isRateLimitError(message: string): boolean {
    if (!message) return false;
    const normalized = message.toLowerCase();
    if (normalized.includes("429")) return true;
    if (normalized.includes("rate limit")) return true;
    if (normalized.includes("too many requests")) return true;

    const codeMatch = message.match(RATE_LIMIT_CODE_REGEX);
    if (codeMatch) {
        const code = Number.parseInt(codeMatch[1] ?? "", 10);
        return code === 88;
    }

    return false;
}

export async function performBulkUnfollow(data:any) {

    const userIds = Array.isArray(data?.userIds) ? data.userIds.map(String) : [];
    const throttleMs = typeof data?.throttleMs === "number" ? data.throttleMs : 1100;

    const total = userIds.length;
    let succeeded = 0;
    let failed = 0;
    const errors: Array<{ userId: string; err: string }> = [];

    let rateLimitFailures = 0;
    let abortRemaining = false;
    let abortReason = "";

    for (let index = 0; index < userIds.length; index++) {
        const userId = userIds[index];
        if (abortRemaining) {
            failed++;
            errors.push({ userId, err: abortReason || "Skipped due to rate limits." });
            continue;
        }

        let handled = false;
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                const ok = await unfollowUser(userId);
                if (ok) {
                    succeeded++;
                } else {
                    failed++;
                    errors.push({ userId, err: "Request failed" });
                }
                handled = true;
                break;
            } catch (error) {
                const message = (error as Error)?.message ?? String(error);
                const isRateLimit = isRateLimitError(message);
                const shouldRetry = isRateLimit && attempt === 0;

                if (shouldRetry) {
                    await sleep(RATE_LIMIT_BACKOFF_MS);
                    continue;
                }

                failed++;
                errors.push({ userId, err: message });

                if (isRateLimit) {
                    rateLimitFailures++;
                    if (rateLimitFailures >= 2) {
                        abortRemaining = true;
                        abortReason = message || "Rate limit exceeded. Remaining requests skipped.";
                    }
                }
                handled = true;
                break;
            }
        }

        if (!handled) {
            failed++;
            errors.push({ userId, err: "Failed to unfollow user after retries." });
        }

        if (!abortRemaining && index < userIds.length - 1) {
            await sleep(throttleMs);
        }
    }

    return { total, succeeded, failed, errors };
}
