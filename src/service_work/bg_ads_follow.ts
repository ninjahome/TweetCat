import { getCurrentUser } from "@coinbase/cdp-core";
import { __tableAdsFollowClaimState, checkAndInitDatabase, databaseDelete, databaseGet, databaseUpdateOrAddItem } from "../common/database";
import { initCDP } from "../common/x402_obj";
import { x402WorkerFetch, getEOA } from "../wallet/cdp_wallet";
import { getFollowOfferForProfile, pollAdsFeedIfNeeded } from "./bg_ads_feed";

export type AdsFollowClaimState = {
    ad_id: string;
    profileUrl?: string;
    status: "processing" | "claimed_pending_proof";
    claim_id?: string;
    claimed_at: number;
    expires_at: number;
    updated_at: number;
};

const CLAIM_TTL_MS = 24 * 60 * 60 * 1000;
import { API_PATH_ADS_CLAIM } from "../common/api_paths";

async function getExecutorIdentity(): Promise<{ xId: string; walletAddress: string }> {
    await initCDP();
    const user = await getCurrentUser();
    if (!user) throw new Error("Please sign in first");

    const xId = user?.authenticationMethods?.x?.sub;
    if (!xId) throw new Error("X account not connected. Please sign in with X");

    const eoa = await getEOA();
    if (!eoa?.address) throw new Error("Wallet not found. Please create a wallet first");

    return { xId, walletAddress: eoa.address };
}

async function getClaimState(adId: string): Promise<AdsFollowClaimState | null> {
    await checkAndInitDatabase();
    const row = (await databaseGet(__tableAdsFollowClaimState, adId)) as AdsFollowClaimState | null;
    if (!row) return null;
    if (Number.isFinite(row.expires_at) && Date.now() > row.expires_at) {
        await databaseDelete(__tableAdsFollowClaimState, adId);
        return null;
    }
    return row;
}

async function setClaimState(state: AdsFollowClaimState): Promise<void> {
    await checkAndInitDatabase();
    await databaseUpdateOrAddItem(__tableAdsFollowClaimState, state);
}

async function clearClaimState(adId: string): Promise<void> {
    await checkAndInitDatabase();
    await databaseDelete(__tableAdsFollowClaimState, adId);
}

export async function queryAdsFollowOffer(profileUrl: string): Promise<{
    offer: any | null;
    claim_state: AdsFollowClaimState | null;
}> {
    const offer = await getFollowOfferForProfile(profileUrl);
    if (!offer) return { offer: null, claim_state: null };

    const claim_state = await getClaimState(offer.ad_id);
    return { offer, claim_state };
}

export async function claimAdsFollowOffer(params: { ad_id: string; profileUrl?: string }): Promise<any> {
    const ad_id = String(params?.ad_id || "");
    if (!ad_id) throw new Error("missing ad_id");

    const existing = await getClaimState(ad_id);
    if (existing?.status === "claimed_pending_proof") {
        return { claim_state: existing, reused: true };
    }

    const now = Date.now();
    const expires_at = now + CLAIM_TTL_MS;

    await setClaimState({
        ad_id,
        profileUrl: params?.profileUrl,
        status: "processing",
        claimed_at: now,
        expires_at,
        updated_at: now,
    });

    try {
        const { xId, walletAddress } = await getExecutorIdentity();

        const resp = await x402WorkerFetch(API_PATH_ADS_CLAIM, {
            ad_id,
            b_x_id: xId,
            b_wallet: walletAddress,
        });

        const claim_id = String(resp?.claim_id || "");
        await setClaimState({
            ad_id,
            profileUrl: params?.profileUrl,
            status: "claimed_pending_proof",
            claim_id: claim_id || undefined,
            claimed_at: now,
            expires_at,
            updated_at: Date.now(),
        });

        // 快速刷新本地缓存（服务端 claim 会 bump version）
        await pollAdsFeedIfNeeded(true);

        return { success: true, resp, claim_state: await getClaimState(ad_id) };
    } catch (e) {
        await clearClaimState(ad_id);
        // Force refresh feed on failure (e.g. quota full, ad expired)
        // This ensures the stale ad is removed from local cache
        await pollAdsFeedIfNeeded(true);
        throw e;
    }
}

