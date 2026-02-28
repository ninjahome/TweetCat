import { __DBK_ADS_FEED_NEXT_INVALIDATION_AT, __DBK_ADS_FEED_VERSION, __DBK_ADS_FOLLOW_OFFER_CACHE } from "../common/consts";
import { logAdsFeed } from "../common/debug_flags";
import { __tableAdsFeedMeta, __tableAdsFollowOffers, checkAndInitDatabase, databaseClear, databaseGet, databaseUpdateOrAddItem } from "../common/database";
import { localGet, localSet } from "../common/local_storage";
import { X402_FACILITATORS } from "../common/x402_obj";
import { getChainId } from "../wallet/wallet_setting";

export type AdCategory = "follow" | "visit" | "register" | "share";

export type FollowOffer = {
    ad_id: string;
    reward_usdc: number;
    detail_url: string;
    deadline_text?: string;
    title?: string;
    created_at?: number;
};

type ExecutorAd = {
    id: string;
    title?: string;
    category: AdCategory;
    rewardUSDC: number;
    createdAt?: number;
    deadlineText?: string;
    detailUrl: string;
};

type VersionRsp = {
    success: boolean;
    version: number;
    next_invalidation_at: string | null;
};

const ADS_FEED_VERSION_PATH = "/ads/executor/version";
const ADS_FEED_LIST_PATH = "/ads/executor/list";

const POLL_LOCK_KEY = "__ADS_FEED_POLL_LOCK__";
let pollInFlight = false;

function normalizeProfileUrl(raw: string): string | null {
    try {
        const u = new URL(raw);
        const host = u.hostname.toLowerCase();
        if (host !== "x.com" && host !== "twitter.com") return null;

        const parts = u.pathname.split("/").filter(Boolean);
        if (parts.length !== 1) return null;
        const username = parts[0].toLowerCase();
        if (!username) return null;
        return `https://x.com/${username}`;
    } catch {
        return null;
    }
}

function pickBetterOffer(a: FollowOffer | null, b: FollowOffer): FollowOffer {
    if (!a) return b;
    if (b.reward_usdc > a.reward_usdc + 1e-12) return b;
    if (b.reward_usdc + 1e-12 < a.reward_usdc) return a;
    const at = Number.isFinite(a.created_at as any) ? Number(a.created_at) : 0;
    const bt = Number.isFinite(b.created_at as any) ? Number(b.created_at) : 0;
    return bt > at ? b : a;
}

async function getWorkerEndpoint(): Promise<string> {
    const chainId = await getChainId();
    const facilitator = X402_FACILITATORS[chainId];
    if (!facilitator?.endpoint) throw new Error(`Missing facilitator endpoint for chainId=${chainId}`);
    return facilitator.endpoint;
}

async function fetchJson<T>(url: string): Promise<T> {
    try {
        const resp = await fetch(url, {
            method: "GET",
            headers: { "Content-Type": "application/json" },
            referrerPolicy: "no-referrer",
            credentials: "omit"
        });
        if (!resp.ok) {
            const text = await resp.text().catch(() => "");
            throw new Error(`GET ${url} failed: ${resp.status} ${text}`);
        }
        return await resp.json() as T;
    } catch (e) {
        logAdsFeed(`fetchJson failed for ${url}:`, e);
        throw e;
    }
}

export async function pollAdsFeedIfNeeded(forceListFetch: boolean = false): Promise<void> {
    if (pollInFlight) return;
    pollInFlight = true;
    let lockAcquired = false;

    try {
        logAdsFeed("poll start", { forceListFetch });
        // crude cross-event lock to avoid duplicate bursts in SW wakeups
        const locked = await localGet(POLL_LOCK_KEY);
        if (locked && !forceListFetch) {
            logAdsFeed("skip: lock already held", { locked });
            return;
        }
        await localSet(POLL_LOCK_KEY, Date.now());
        lockAcquired = true;

        const endpoint = await getWorkerEndpoint();
        const ver = await fetchJson<VersionRsp>(endpoint + ADS_FEED_VERSION_PATH);
        if (!ver?.success) {
            logAdsFeed("skip: version api returned success=false");
            return;
        }

        const lastVersion = Number(await localGet(__DBK_ADS_FEED_VERSION) ?? 0) || 0;
        const nextInvStr = (await localGet(__DBK_ADS_FEED_NEXT_INVALIDATION_AT)) as string | null;
        const nextInv = nextInvStr ? Date.parse(nextInvStr) : NaN;
        const now = Date.now();

        const versionChanged = ver.version !== lastVersion;
        const invalidatedByTime = !!ver.next_invalidation_at && Number.isFinite(Date.parse(ver.next_invalidation_at)) && now >= Date.parse(ver.next_invalidation_at);
        const shouldFetchList = forceListFetch || versionChanged || invalidatedByTime || (Number.isFinite(nextInv) && now >= nextInv);

        logAdsFeed("version fetched", {
            lastVersion,
            version: ver.version,
            versionChanged,
            next_invalidation_at: ver.next_invalidation_at,
            invalidatedByTime,
            cached_next_invalidation_at: nextInvStr,
            cached_invalidatedByTime: Number.isFinite(nextInv) ? now >= nextInv : null,
            shouldFetchList,
        });

        await localSet(__DBK_ADS_FEED_VERSION, ver.version);
        await localSet(__DBK_ADS_FEED_NEXT_INVALIDATION_AT, ver.next_invalidation_at);

        try {
            await checkAndInitDatabase();
            await databaseUpdateOrAddItem(__tableAdsFeedMeta, {
                id: 1,
                version: ver.version,
                next_invalidation_at: ver.next_invalidation_at,
                updated_at: Date.now(),
            });
        } catch (e) {
            logAdsFeed("warn: failed to persist ads feed meta to IndexedDB", e);
        }

        if (!shouldFetchList) {
            logAdsFeed("skip: no list fetch needed");
            return;
        }

        const list = await fetchJson<any>(endpoint + ADS_FEED_LIST_PATH);
        if (!Array.isArray(list)) {
            logAdsFeed("skip: list api not array");
            return;
        }

        const cache: Record<string, FollowOffer> = {};

        (list as ExecutorAd[]).forEach((ad) => {
            if (!ad || ad.category !== "follow") return;
            const key = normalizeProfileUrl(ad.detailUrl);
            if (!key) return;
            const offer: FollowOffer = {
                ad_id: ad.id,
                reward_usdc: Number(ad.rewardUSDC) || 0,
                detail_url: ad.detailUrl,
                deadline_text: ad.deadlineText,
                title: ad.title,
                created_at: Number.isFinite(ad.createdAt as any) ? Number(ad.createdAt) : undefined,
            };
            cache[key] = pickBetterOffer(cache[key] ?? null, offer);
        });

        await localSet(__DBK_ADS_FOLLOW_OFFER_CACHE, cache);

        try {
            await checkAndInitDatabase();
            await databaseClear(__tableAdsFollowOffers);
            const entries = Object.entries(cache);
            for (const [profileUrl, offer] of entries) {
                await databaseUpdateOrAddItem(__tableAdsFollowOffers, {
                    profileUrl,
                    ...offer,
                    updated_at: Date.now(),
                });
            }
            logAdsFeed("persisted follow offers to IndexedDB", { count: entries.length });
        } catch (e) {
            logAdsFeed("warn: failed to persist follow offers to IndexedDB", e);
        }
    } finally {
        if (lockAcquired) {
            await localSet(POLL_LOCK_KEY, null);
        }
        pollInFlight = false;
    }
}

export async function getFollowOfferForProfile(profileUrl: string): Promise<FollowOffer | null> {
    const key = normalizeProfileUrl(profileUrl);
    if (!key) return null;
    const cache = (await localGet(__DBK_ADS_FOLLOW_OFFER_CACHE)) as Record<string, FollowOffer> | null;
    const offer = cache?.[key];
    if (offer) return offer;

    try {
        await checkAndInitDatabase();
        const row = await databaseGet(__tableAdsFollowOffers, key);
        if (!row) return null;
        return {
            ad_id: row.ad_id,
            reward_usdc: Number(row.reward_usdc) || 0,
            detail_url: row.detail_url,
            deadline_text: row.deadline_text,
            title: row.title,
            created_at: row.created_at,
        };
    } catch (e) {
        logAdsFeed("warn: failed to read follow offer from IndexedDB", e);
        return null;
    }
}
