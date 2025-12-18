import { ethers } from "ethers";
import browser from "webextension-polyfill";

const SESSION_KEY_ID = "x402_session_key";      // 存储 AES key (hex string)
const SESSION_DATA_ID = "x402_session_data";    // 存储 { blob: hex, expiresAt }
const DEFAULT_WALLET_TTL = 30//TODO:: config this param
interface SessionData {
    blob: string;         // hex: IV (12 bytes) + ciphertext
    expiresAt: number;
}

interface CreateOptions {
    ttlMinutes?: number;
}

/**
 * 创建会话：传入已解密的 wallet
 */
export async function createWalletSession(
    wallet: ethers.Wallet,
    options: CreateOptions = {}
): Promise<void> {
    const ttlMinutes = options.ttlMinutes ?? DEFAULT_WALLET_TTL;

    // 1. 生成随机 session key (256 bit) 和 IV (96 bit)
    const sessionKey = crypto.getRandomValues(new Uint8Array(32));
    const iv = crypto.getRandomValues(new Uint8Array(12));

    // 2. 导入 key 用于加密
    const cryptoKey = await crypto.subtle.importKey(
        "raw",
        sessionKey,
        "AES-GCM",
        false,
        ["encrypt"]
    );

    // 3. 加密私钥
    const encrypted = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        cryptoKey,
        new TextEncoder().encode(wallet.privateKey)
    );

    // 4. 拼接 IV + ciphertext
    const combined = new Uint8Array(iv.byteLength + encrypted.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(encrypted), iv.byteLength);

    // 5. 存储
    const sessionData: SessionData = {
        blob: ethers.utils.hexlify(combined),
        expiresAt: Date.now() + ttlMinutes * 60 * 1000,
    };

    await browser.storage.session.set({
        [SESSION_KEY_ID]: ethers.utils.hexlify(sessionKey),
        [SESSION_DATA_ID]: sessionData,
    });

    // 可选：限制访问级别（推荐）
    if ("setAccessLevel" in browser.storage.session) {
        await (browser.storage.session as any).setAccessLevel({
            accessLevel: "TRUSTED_CONTEXTS",
        });
    }
}

/**
 * 获取会话中的 wallet（自动检查过期）
 */
export async function getSessionWallet(): Promise<ethers.Wallet | null> {
    try {
        const result = await browser.storage.session.get([SESSION_KEY_ID, SESSION_DATA_ID]);

        const sessionKeyHex = result[SESSION_KEY_ID] as string | undefined;
        const sessionData = result[SESSION_DATA_ID] as SessionData | undefined;

        if (!sessionKeyHex || !sessionData || Date.now() > sessionData.expiresAt) {
            await clearWalletSession();
            return null;
        }

        // 关键修复：不用 ethers.utils.arrayify，直接用原生方式转 Uint8Array
        const combined = Uint8Array.from(
            sessionData.blob.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16))
        );

        const iv = combined.slice(0, 12);
        const ciphertext = combined.slice(12);

        const sessionKey = Uint8Array.from(
            sessionKeyHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16))
        );

        const cryptoKey = await crypto.subtle.importKey(
            "raw",
            sessionKey,
            "AES-GCM",
            false,
            ["decrypt"]
        );

        const decrypted = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv },
            cryptoKey,
            ciphertext
        );

        const privateKey = new TextDecoder().decode(decrypted);
        return new ethers.Wallet(privateKey);
    } catch (err) {
        console.error("getSessionWallet failed:", err);
        await clearWalletSession();
        return null;
    }
}

/**
 * 检查是否有有效会话
 */
export async function hasValidSession(): Promise<boolean> {
    return (await getSessionWallet()) !== null;
}

/**
 * 手动清除会话（立即锁定）
 */
export async function clearWalletSession(): Promise<void> {
    await browser.storage.session.remove([SESSION_KEY_ID, SESSION_DATA_ID]);
}