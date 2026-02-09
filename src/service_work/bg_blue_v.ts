import { initCDP } from "../common/x402_obj";
import { getCurrentUser } from "@coinbase/cdp-core";
import { saveCurrentUserBlueVStatus, parseBlueVFromUserByScreenName } from "../object/blue_v";

/**
 * 处理捕获到的 UserByScreenName 数据
 * 检查是否是当前登录用户，如果是，保存其蓝V状态
 */
export async function handleUserByScreenNameCaptured(data: any) {
    try {
        const profileRaw = data?.profile || data?.data;
        if (!profileRaw) return;

        const parsed = parseBlueVFromUserByScreenName(profileRaw);
        if (!parsed) {
            // console.log("[BlueV] Parse failed for raw data:", JSON.stringify(profileRaw).substring(0, 200));
            return;
        }

        const { userId, screenName, isBlueVerified } = parsed;

        // 保存状态。saveCurrentUserBlueVStatus 内部会处理 storage.local 和 DB
        await saveCurrentUserBlueVStatus({
            userId,
            screenName,
            isBlueVerified,
            capturedAt: Date.now()
        });

        console.log(`[BlueV] [Background] Updated status for @${screenName}: ${isBlueVerified}`);
    } catch (e) {
        // 静默失败
        console.error("[BlueV] Background process error:", e);
    }
}
