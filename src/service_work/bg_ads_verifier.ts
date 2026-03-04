import { fetchProfileSpotlights, setExternalCsrfToken } from "../x_api/twitter_api";
import { x402WorkerFetch } from "../wallet/cdp_wallet";
import { API_PATH_ADS_CLAIM, API_PATH_ADS_SUBMIT_PROOF } from "../common/api_paths";
import browser from "webextension-polyfill";
import { setClaimState } from "./bg_ads_follow";
import { pollAdsFeedIfNeeded } from "./bg_ads_feed";

/**
 * 从浏览器 Cookie 中同步 CSRF Token (ct0) 到 twitter_api 模块
 */
async function syncTwitterCredentials(): Promise<boolean> {
    const cookie = await browser.cookies.get({ url: 'https://x.com', name: 'ct0' });
    if (cookie && cookie.value) {
        setExternalCsrfToken(cookie.value);
        return true;
    } else {
        console.warn("[AdsVerifier] Failed to get ct0 cookie from x.com");
        return false;
    }
}

import { getCurrentUserBlueVStatus } from "../object/blue_v";

/**
 * 核心校验与申领逻辑：
 * 1. 验证用户确实关注了目标 KOL
 * 2. 获取本地签名的蓝V证据 (防篡改)
 * 3. 准备原始证明材料 (JSON)
 * 4. 提交给服务器进行原子化申领
 */
export async function verifyFollowAndClaim(params: {
    ad_id: string;
    screen_name: string;
    profileUrl?: string;
    userId?: string;          // CDP User ID (来自 Content / Offscreen)
    xId?: string;             // 推特内部 ID (来自 Content / Offscreen)
    walletAddress?: string;   // 钱包地址 (来自 Content / Offscreen)
}): Promise<any> {
    const { ad_id, screen_name, userId, xId, walletAddress } = params;
    console.log(`[AdsVerifier] [LOG_START] Verification triggered for @${screen_name}, Ad: ${ad_id}`);

    try {
        // 1. 同步凭证
        console.log(`[AdsVerifier] Step 1: Syncing Twitter credentials (ct0)...`);
        const syncOk = await syncTwitterCredentials();
        console.log(`[AdsVerifier] Step 1 result: syncOk=${syncOk}`);

        // 2. 发起独立审计查询 (ProfileSpotlightsQuery)
        console.log(`[AdsVerifier] Step 2: Fetching ProfileSpotlights from Twitter API for @${screen_name}...`);
        const spotlightData = await fetchProfileSpotlights(screen_name);
        if (!spotlightData) {
            console.error(`[AdsVerifier] Step 2 FAILED: No data returned from fetchProfileSpotlights`);
            throw new Error("无法从推特获取验证材料 (Rate limit or Auth error)");
        }
        console.log(`[AdsVerifier] Step 2 result: Spotlight data received.`);

        // 3. 检查关注状态
        console.log(`[AdsVerifier] Step 3: Extracting following status...`);
        const following = spotlightData?.data?.user_result_by_screen_name?.result?.relationship_perspectives?.following;
        console.log(`[AdsVerifier] Step 3 result: following=${following}`);

        if (following !== true) {
            console.warn(`[AdsVerifier] Step 3 FAILED: Target is not followed by the user.`, spotlightData);
            throw new Error(`关注验证失败：推特接口返回您尚未关注 @${screen_name}`);
        }

        // 4. 身份确认与证据获取 (蓝V签名证据)
        if (!userId || !xId) {
            console.error(`[AdsVerifier] Step 4 FAILED: Missing identity info. userId=${!!userId}, xId=${!!xId}`);
            throw new Error("身份信息不完整，请尝试重新登录钱包。");
        }

        console.log(`[AdsVerifier] Step 4: Identity validated. Querying BlueV proof for xId: ${xId}`);
        const blueVProof = await getCurrentUserBlueVStatus(xId);
        if (!blueVProof || !blueVProof.isBlueVerified || !blueVProof.signature) {
            console.warn(`[AdsVerifier] Step 4 Warning: No signed BlueV proof found for ${xId}`);
            // 如果强制要求，这里可以 throw。目前先尝试提交。
        }

        // 5. 提交申领 (原子化一步：占位 + 交卷)
        console.log(`[AdsVerifier] Step 5: Submitting claim & mixed proofs to backend...`);

        const resp = await x402WorkerFetch(API_PATH_ADS_CLAIM, {
            ad_id,
            b_x_id: xId,
            b_wallet: walletAddress || "",
            // 证据1: 关注关系证明
            proof_data: JSON.stringify(spotlightData),
            proof_type: "twitter_profile_spotlight",
            // 证据2: 蓝V身份证明（带签名）
            blue_v_proof: blueVProof ? JSON.stringify(blueVProof) : null,
            category: "follow"
        }, userId);

        console.log(`[AdsVerifier] [LOG_END] Claim & Proof SUCCESS:`, resp);

        // Persist the claimed state locally so the UI can reflect it even if user unfollows
        if (resp && typeof resp === 'object') {
            await setClaimState({
                ad_id,
                status: "claimed",
                claimed_at: Date.now(),
                updated_at: Date.now(),
                expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000, // Keep for 30 days
                profileUrl: params.profileUrl
            });

            // Trigger feed poll to update quotas/list after successful claim
            pollAdsFeedIfNeeded(true).catch(e => console.warn("[AdsVerifier] background poll failed:", e));
        }

        return resp;
    } catch (err: any) {
        console.error(`[AdsVerifier] [LOG_ERROR] flow interrupted:`, err);
        throw err;
    }
}
