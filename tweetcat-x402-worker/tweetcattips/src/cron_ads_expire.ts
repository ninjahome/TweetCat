import { Env } from "./common";

/**
 * 广告过期自动处理
 * 将满足过期或任务完成条件的广告状态在 DB 中显式更新为 EXPIRED 或 COMPLETED
 */
export async function cronExpireAds(env: Env) {
    console.log("[Cron] Starting ad expiration scan...");

    // 1. 查找已到期但状态还是 ACTIVE/PAUSED 的广告
    const expireSql = `
        UPDATE ad_campaigns
        SET status = 'EXPIRED', updated_at = datetime('now')
        WHERE status IN ('ACTIVE', 'PAUSED_MANUAL', 'PAUSED_NO_BUDGET')
          AND end_date < datetime('now')
    `;

    // 2. 查找配额已满但状态还是 ACTIVE/PAUSED 的广告
    // 逻辑：max(quota_claimed, quota_used) >= quota_total
    const completeSql = `
        UPDATE ad_campaigns
        SET status = 'COMPLETED', updated_at = datetime('now')
        WHERE status IN ('ACTIVE', 'PAUSED_MANUAL', 'PAUSED_NO_BUDGET')
          AND (
            CASE 
                WHEN quota_claimed IS NOT NULL THEN MAX(quota_claimed, quota_used)
                ELSE quota_used
            END
          ) >= quota_total
    `;

    try {
        const resExp = await env.DB.prepare(expireSql).run();
        const resComp = await env.DB.prepare(completeSql).run();

        if ((resExp.meta.changes ?? 0) > 0 || (resComp.meta.changes ?? 0) > 0) {
            console.log(`[Cron] Ad expiration finished. Expired: ${resExp.meta.changes}, Completed: ${resComp.meta.changes}`);
        }
    } catch (err) {
        console.error("[Cron] Error in cronExpireAds:", err);
    }
}
