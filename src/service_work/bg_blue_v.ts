import { initCDP } from "../common/x402_obj";
import { getCurrentUser } from "@coinbase/cdp-core";
import { saveCurrentUserBlueVStatus } from "../object/blue_v";

/**
 * 处理捕获到的 UserByScreenName 数据
 * 检查是否是当前登录用户，如果是，保存其蓝V状态
 */
export async function handleUserByScreenNameCaptured(data: any) {
    try {
        const profile = data?.profile;
        if (!profile || typeof profile !== 'object') return;

        // profile 已经是 user result 对象 (rest_id, legacy, etc)
        const userId = profile.rest_id || profile.id;
        const isBlueVerified = !!profile.is_blue_verified;
        const screenName = profile.legacy?.screen_name || data.screenName;

        if (!userId) return;

        // 获取当前 CDP 登录用户
        // 注意：Background SW 中可能无法完整初始化 CDP 如果涉及 DOM 操作，
        // 但根据 bg_ads_follow.ts 的先例，似乎是可以读取 storage 中的 auth 状态的。
        await initCDP();
        const user = await getCurrentUser();
        const currentXId = user?.authenticationMethods?.x?.sub;

        if (!currentXId) return;

        // 比较 ID
        if (currentXId === userId) {
            await saveCurrentUserBlueVStatus({
                userId,
                screenName,
                isBlueVerified,
                capturedAt: Date.now()
            });
            console.log(`[BlueV] Captured & Updated status for current user @${screenName}: ${isBlueVerified}`);
        }
    } catch (e) {
        // 静默失败，不要打扰主流程
        // console.warn("[BlueV] Background check failed:", e);
    }
}
