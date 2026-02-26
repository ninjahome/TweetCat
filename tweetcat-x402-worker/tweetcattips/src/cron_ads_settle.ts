import { Env } from "./common";
import { getPendingSettlementClaims, settleAdReward, rejectAdReward } from "./database_ad";

/**
 * 广告结算定时任务
 * 扫描超过 24 小时的 PENDING_CONFIRM 任务进行扣费结算
 */
export async function cronSettleAds(env: Env) {
    console.log("[Cron] Starting ad settlement scan...");

    const delayHours = env.SETTLEMENT_DELAY_HOURS || 24;
    console.log(`[Cron] Settlement delay: ${delayHours} hours`);

    // 每次处理 50 条，防止超时
    const claims = await getPendingSettlementClaims(env.DB, delayHours, 50);

    if (claims.length === 0) {
        // console.log("[Cron] No claims to settle.");
        return;
    }

    console.log(`[Cron] Found ${claims.length} claims ready for settlement.`);

    let settledCount = 0;
    let failCount = 0;

    for (const claim of claims) {
        try {
            // --- Proof Validation Logic ---
            let isValid = false;
            let rejectionReason = "Unknown proof type";

            // 目前只支持 twitter_profile_spotlight 类型的验证
            if (claim.proof_type === 'twitter_profile_spotlight' && claim.proof_data) {
                try {
                    const proofJson = JSON.parse(claim.proof_data);
                    const relationship = proofJson?.data?.user_result_by_screen_name?.result;

                    if (!relationship) {
                        rejectionReason = "Invalid spotlight data: user result not found";
                    } else {
                        // 1. 提取正在被关注的 KOL 账号名 (from proof)
                        // 兼容不同版本的 Twitter GQL 结构 (legacy 或 core)
                        const proofScreenName = String(
                            relationship.legacy?.screen_name ||
                            relationship.core?.screen_name ||
                            ""
                        ).toLowerCase();

                        // 2. 提取广告主要求的 KOL 账号名 (from ad detail_url)
                        // detail_url 格式一般为 https://x.com/username 或 https://twitter.com/username
                        let targetScreenName = "";
                        try {
                            const url = new URL(claim.detail_url);
                            targetScreenName = url.pathname.split('/').filter(Boolean)[0].toLowerCase();
                        } catch (ue) {
                            console.error(`[Cron] Invalid detail_url format: ${claim.detail_url}`);
                        }

                        // 3. 交叉校验：Proof 中的 ID 必须匹配广告投放的 Target
                        if (!targetScreenName || proofScreenName !== targetScreenName) {
                            rejectionReason = `Target mismatch. Ad expects @${targetScreenName}, but proof is for @${proofScreenName}`;
                        } else {
                            // 4. 最终检查关注状态
                            const following = relationship.relationship_perspectives?.following;
                            if (following === true) {
                                isValid = true;
                            } else {
                                rejectionReason = "Twitter API indicates not following";
                            }
                        }
                    }
                } catch (e) {
                    rejectionReason = "Malformed proof JSON";
                }
            } else if (!claim.proof_data) {
                rejectionReason = "Missing proof data";
            } else {
                rejectionReason = `Unsupported proof type: ${claim.proof_type}`;
            }

            if (!isValid) {
                console.warn(`[Cron] Rejecting claim ${claim.claim_id} for Ad ${claim.ad_id}: ${rejectionReason}`);
                await rejectAdReward(env.DB, claim.claim_id, rejectionReason);
                failCount++;
                continue;
            }
            // ------------------------------

            const success = await settleAdReward(env.DB, {
                claimId: claim.claim_id,
                adId: claim.ad_id,
                aXId: claim.a_x_id,
                bXId: claim.b_x_id,
                rewardAtomic: claim.unit_price_atomic
            });

            if (success) {
                settledCount++;
            } else {
                failCount++;
                console.warn(`[Cron] Failed to settle claim ${claim.claim_id} (likely insufficient frozen balance)`);
            }
        } catch (err) {
            failCount++;
            console.error(`[Cron] Exception settling claim ${claim.claim_id}:`, err);
        }
    }

    console.log(`[Cron] Ad settlement finished. Success: ${settledCount}, Fail: ${failCount}`);
}
