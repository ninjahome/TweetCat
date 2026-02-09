/**
 * 当前登录用户的蓝V状态管理
 * 
 * 数据来源：UserByScreenName GraphQL 响应中的 is_blue_verified 字段
 * 存储位置：browser.storage.local
 * 
 * MVP 阶段：信任前端检查，后端不做强校验
 */

import { localGet, localSet } from "../common/local_storage";

const STORAGE_KEY_CURRENT_USER_BLUE_V = "current_user_blue_v";

export interface CurrentUserBlueVInfo {
    userId: string;         // X User ID
    screenName: string;     // X Username (不含 @)
    isBlueVerified: boolean;
    capturedAt: number;     // 捕获时间戳
}

/**
 * 保存当前用户的蓝V状态（由 inject 捕获 UserByScreenName 后调用）
 */
export async function saveCurrentUserBlueVStatus(info: CurrentUserBlueVInfo): Promise<void> {
    await localSet(STORAGE_KEY_CURRENT_USER_BLUE_V, info);
    console.log("[BlueV] saved:", info);
}

/**
 * 获取当前用户的蓝V状态
 * @returns 蓝V信息，如果未缓存则返回 null
 */
export async function getCurrentUserBlueVStatus(): Promise<CurrentUserBlueVInfo | null> {
    const info = await localGet(STORAGE_KEY_CURRENT_USER_BLUE_V);
    if (!info) return null;
    return info as CurrentUserBlueVInfo;
}

/**
 * 检查当前用户是否是蓝V
 * @returns true = 蓝V, false = 非蓝V, null = 状态未知（未缓存）
 */
export async function isCurrentUserBlueVerified(): Promise<boolean | null> {
    const info = await getCurrentUserBlueVStatus();
    if (!info) return null;
    return info.isBlueVerified;
}

/**
 * 从 UserByScreenName GraphQL 响应中提取蓝V状态
 */
export function parseBlueVFromUserByScreenName(raw: any): { userId: string; screenName: string; isBlueVerified: boolean } | null {
    try {
        const u = raw?.data?.user?.result || raw?.data?.user_result_by_screen_name?.result;
        if (!u) return null;

        const userId = u.rest_id || u.id || "";
        const screenName = u.legacy?.screen_name || u.core?.screen_name || "";
        const isBlueVerified = !!u.is_blue_verified;

        if (!userId || !screenName) return null;

        return { userId, screenName, isBlueVerified };
    } catch {
        return null;
    }
}
