import {__tableFollowings, checkAndInitDatabase, databaseDeleteByFilter, databaseQueryAll, databaseQueryByFilter, databaseUpdateFields, databaseUpdateOrAddItem} from "../common/database";
import {isTcMessage, TcMessage} from "../common/msg_obj";
import {MsgType} from "../common/consts";
import {handleLocationChange} from "../timeline/route_helper";
import {processCapturedHomeLatest, processCapturedTweetDetail, processCapturedTweets} from "../timeline/tweet_fetcher";
import {appendScoreInfoToProfilePage} from "../content/twitter_ui";
import {fetchFollowingPage, getUserByUsername} from "../timeline/twitter_api";
import {sleep} from "../common/utils";

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

