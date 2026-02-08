import { Env } from "./common";
import { getPendingSettlementClaims, settleAdReward } from "./database_ad";

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
            const success = await settleAdReward(env.DB, {
                claimId: claim.claim_id,
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
