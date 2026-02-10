/**
 * 当前登录用户的蓝V状态管理
 * 
 * 使用 IndexedDB (__tableUserBlueVStatus) 作为唯一数据源。
 * 注意：由于 IndexedDB 在 Content Script 和 Extension Origin 之间不共享，
 * Web 页面（Content Script）必须通过 sendMessage 将数据发送给 Background 进行存储，
 * 而 Popup 和 Background 则可以直接访问同一个 IndexedDB。
 */

import { __tableUserBlueVStatus, checkAndInitDatabase, databaseGet, databaseUpdateOrAddItem } from "../common/database";
import { signDeviceData } from "../common/device_key";

export interface CurrentUserBlueVInfo {
    userId: string;         // X User ID
    screenName: string;     // X Username (不含 @)
    isBlueVerified: boolean;
    capturedAt: number;     // 捕获时间戳
    signature?: string;     // 设备私钥对上述字段的签名
    devicePubKey?: string;  // 用于验证签名的设备公钥
}

/**
 * 保存用户的蓝V状态
 * 使用设备私钥对关键字段进行签名，防止本地篡改
 */
export async function saveCurrentUserBlueVStatus(info: CurrentUserBlueVInfo): Promise<void> {
    if (!info.userId) return;

    // 准备待签名数据 (固定顺序以确保一致性)
    const dataToSign = JSON.stringify({
        userId: info.userId,
        screenName: info.screenName,
        isBlueVerified: info.isBlueVerified,
        capturedAt: info.capturedAt
    });

    try {
        const { signatureB64, publicKeyB64 } = await signDeviceData(dataToSign);
        info.signature = signatureB64;
        info.devicePubKey = publicKeyB64;
    } catch (e) {
        console.warn("[BlueV] Failed to sign device data:", e);
        // 如果签名失败，在此安全增强模式下，我们依然保存但可能在提交时被拒
    }

    await checkAndInitDatabase();
    await databaseUpdateOrAddItem(__tableUserBlueVStatus, info);
    console.log(`[BlueV] Signed & Saved to DB for ${info.userId}:`, info.isBlueVerified);
}

/**
 * 获取指定用户的蓝V状态
 * 此函数在 Popup 或 Background 中调用时，读取的是同一个 IndexedDB
 */
export async function getCurrentUserBlueVStatus(userId?: string): Promise<CurrentUserBlueVInfo | null> {
    if (!userId) return null;
    await checkAndInitDatabase();
    const info = await databaseGet(__tableUserBlueVStatus, userId);
    return info as CurrentUserBlueVInfo || null;
}

/**
 * 检查当前用户是否是蓝V
 */
export async function isCurrentUserBlueVerified(userId: string): Promise<boolean | null> {
    const info = await getCurrentUserBlueVStatus(userId);
    if (!info) return null;
    return info.isBlueVerified;
}

/**
 * 从 GraphQL 响应中提取蓝V状态
 */
export function parseBlueVFromUserByScreenName(raw: any): { userId: string; screenName: string; isBlueVerified: boolean } | null {
    try {
        // 兼容不同的 GraphQL 接口返回结构
        const u = raw?.data?.user?.result ||
            raw?.data?.user_result_by_screen_name?.result ||
            raw?.data?.user_by_screen_name?.result ||
            raw?.data?.create_friendship?.legacy;

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
