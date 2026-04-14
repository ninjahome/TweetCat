import { Env } from "./common";
import { getAdsForRefund, hasPendingClaimsForAd, refundAdBudget } from "./database_ad";

/**
 * 广告结束后的预算退回处理
 * 扫描已结束 (EXPIRED/COMPLETED) 且没有 pending 任务的广告，将剩余冻结资金退回给广告主
 */
export async function cronRefundAds(env: Env) {
    console.log("[Cron] Starting ad budget refund scan...");

    // 1. 获取进入待结算状态的广告 (每次处理 20 条)
    const ads = await getAdsForRefund(env.DB, 20);

    if (ads.length === 0) {
        // console.log("[Cron] No ads eligible for refund.");
        return;
    }

    console.log(`[Cron] Found ${ads.length} ads candidate for refund.`);

    let refundSuccessCount = 0;
    let skipCount = 0;

    for (const ad of ads) {
        // 2. 检查是否还有待处理的 Claim (CLAIMED 或 PENDING_CONFIRM)
        // 如果有，说明还在 24h 冷却期或等待验证中，不能退款
        const isPending = await hasPendingClaimsForAd(env.DB, ad.ad_id);

        if (isPending) {
            console.log(`[Cron] Skipping refund for ad ${ad.ad_id}: Has pending claims.`);
            skipCount++;
            continue;
        }

        // 3. 执行退款
        const success = await refundAdBudget(env.DB, ad.ad_id, ad.a_x_id);
        if (success) {
            refundSuccessCount++;
            console.log(`[Cron] Budget refunded for ad ${ad.ad_id}.`);
        } else {
            console.error(`[Cron] Failed to refund budget for ad ${ad.ad_id}.`);
        }
    }

    console.log(`[Cron] Ad budget refund finished. Success: ${refundSuccessCount}, Skipped (Pending): ${skipCount}`);
}
