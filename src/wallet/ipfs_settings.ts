import {
    __tableIpfsSettings,
    checkAndInitDatabase,
    databaseDelete,
    databaseQueryAll,
    databaseUpdateOrAddItem
} from "../common/database";

export const PROVIDER_TYPE_TWEETCAT = 'tweetcat'
export const PROVIDER_TYPE_LIGHTHOUSE = 'lighthouse'
export const PROVIDER_TYPE_PINATA = 'pinata'
export const PROVIDER_TYPE_CUSTOM = 'custom'

export type IpfsProvider =
    | typeof PROVIDER_TYPE_PINATA
    | typeof PROVIDER_TYPE_LIGHTHOUSE
    | typeof PROVIDER_TYPE_CUSTOM
    | typeof PROVIDER_TYPE_TWEETCAT;

export interface EncryptedBlock {
    iv: string;
    salt: string;
    cipher: string;
}

export type DecryptedSettings = {
    provider: IpfsProvider;
    pinata?: { apiKey?: string; secret?: string; jwt?: string };
    lighthouse?: { apiKey?: string; jwt?: string };
    custom?: { apiUrl?: string; gatewayUrl?: string; auth?: string };
};

/**
 * 统一解密：根据当前 provider 将已保存的敏感字段解密成明文，供 UI 临时展示
 * 注意：仅返回解密后的值，不做持久化；调用方负责清理。
 */
export async function decryptSettingsForUI(
    s: IpfsSettings,
    password: string
): Promise<DecryptedSettings> {
    const out: DecryptedSettings = {provider: s.provider};

    if (s.provider === PROVIDER_TYPE_PINATA && s.pinata) {
        out.pinata = {
            apiKey: s.pinata.apiKeyEnc ? await decryptString(s.pinata.apiKeyEnc, password) : undefined,
            secret: s.pinata.secretEnc ? await decryptString(s.pinata.secretEnc, password) : undefined,
            jwt: s.pinata.jwtEnc ? await decryptString(s.pinata.jwtEnc, password) : undefined,
        };
    }

    if (s.provider === PROVIDER_TYPE_LIGHTHOUSE && s.lighthouse) {
        out.lighthouse = {
            apiKey: s.lighthouse.apiKeyEnc ? await decryptString(s.lighthouse.apiKeyEnc, password) : undefined,
            jwt: s.lighthouse.jwtEnc ? await decryptString(s.lighthouse.jwtEnc, password) : undefined,
        };
    }

    if (s.provider === PROVIDER_TYPE_CUSTOM && s.custom) {
        out.custom = {
            apiUrl: s.custom.apiUrl,              // 非敏感
            gatewayUrl: s.custom.gatewayUrl,      // 非敏感
            auth: s.custom.authEnc ? await decryptString(s.custom.authEnc, password) : undefined,
        };
    }

    // tweetcat 无敏感字段，不需要解密
    return out;
}


export interface IpfsSettings {
    id: 'ipfs';
    provider: IpfsProvider;
    pinata?: { apiKeyEnc?: EncryptedBlock; secretEnc?: EncryptedBlock; jwtEnc?: EncryptedBlock };
    lighthouse?: { apiKeyEnc?: EncryptedBlock; jwtEnc?: EncryptedBlock };
    custom?: {
        apiUrl: string;
        gatewayUrl?: string;
        authEnc?: EncryptedBlock;
    };
    updatedAt?: number;
}

const SETTINGS_ID: IpfsSettings['id'] = 'ipfs';
const PBKDF2_ITERATIONS = 262_144;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;

let cachedSettings: IpfsSettings | null = null;

function toBase64(buffer: ArrayBuffer | Uint8Array): string {
    const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

function toArrayBuffer(view: Uint8Array): ArrayBuffer {
    const copy = new Uint8Array(view.byteLength);
    copy.set(view);
    return copy.buffer;
}

async function importPasswordKey(password: string) {
    const encoder = new TextEncoder();
    return await crypto.subtle.importKey(
        'raw',
        encoder.encode(password),
        'PBKDF2',
        false,
        ['deriveKey']
    );
}

async function deriveAesKey(password: string, salt: ArrayBuffer) {
    const keyMaterial = await importPasswordKey(password);
    return await crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt,
            iterations: PBKDF2_ITERATIONS,
            hash: 'SHA-256',
        },
        keyMaterial,
        {
            name: 'AES-GCM',
            length: 256,
        },
        false,
        ['encrypt', 'decrypt']
    );
}

export async function encryptString(plain: string, password: string): Promise<EncryptedBlock> {
    if (!password) throw new Error('密码不能为空');
    const encoder = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const key = await deriveAesKey(password, toArrayBuffer(salt));
    const data = encoder.encode(plain);
    const cipherBuffer = await crypto.subtle.encrypt(
        {
            name: 'AES-GCM',
            iv: toArrayBuffer(iv),
        },
        key,
        toArrayBuffer(data)
    );
    return {
        iv: toBase64(iv),
        salt: toBase64(salt),
        cipher: toBase64(cipherBuffer),
    };
}

export async function decryptString(block: EncryptedBlock, password: string): Promise<string> {
    if (!password) throw new Error('密码不能为空');
    const decoder = new TextDecoder();
    const salt = fromBase64(block.salt);
    const iv = fromBase64(block.iv);
    const key = await deriveAesKey(password, toArrayBuffer(salt));
    try {
        const plainBuffer = await crypto.subtle.decrypt(
            {
                name: 'AES-GCM',
                iv: toArrayBuffer(iv),
            },
            key,
            toArrayBuffer(fromBase64(block.cipher))
        );
        return decoder.decode(plainBuffer);
    } catch (err) {
        throw new Error('解密失败，口令可能不正确');
    }
}

export async function loadIpfsSettings(): Promise<IpfsSettings | null> {
    await checkAndInitDatabase();
    const rows = await databaseQueryAll(__tableIpfsSettings) as Array<IpfsSettings & { id: string }>;
    const found = rows.find(item => item.id === SETTINGS_ID) ?? null;
    cachedSettings = found;
    return found;
}

export function getCachedIpfsSettings(): IpfsSettings | null {
    return cachedSettings;
}

export async function saveIpfsSettings(settings: IpfsSettings): Promise<void> {
    await checkAndInitDatabase();
    const payload: IpfsSettings = {
        ...settings,
        id: SETTINGS_ID,
        updatedAt: Date.now(),
    };
    await databaseUpdateOrAddItem(__tableIpfsSettings, payload);
    cachedSettings = payload;
}

export async function deleteIpfsSettings(): Promise<void> {
    await checkAndInitDatabase();
    await databaseDelete(__tableIpfsSettings, SETTINGS_ID);
    cachedSettings = null;
}

export const ERR_LOCAL_IPFS_HANDOFF = '__LOCAL_IPFS_HANDOFF__';

/** 若是 custom 且指向本地 Kubo API，则返回应打开的 WebUI URL；否则返回 null */
export function localUiUrlIfCustom(settings?: IpfsSettings | null): string | null {
    if (!settings || settings.provider !== 'custom') return null;
    const api = settings.custom?.apiUrl?.trim();
    if (!api) return null;
    try {
        const u = new URL(api);
        const host = u.hostname;
        const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1';
        if (!isLocal) return null;

        // 不强制要求一定是 /api/v0；只要是同一个本地节点，我们取它的 origin 来打开 UI
        const origin = `${u.protocol}//${u.host}`;
        // 带上 hash 便于 content script 精确触发（可选）
        return `${origin}/#tweetcat-ipfs`;
    } catch {
        return null;
    }
}

export async function loadIpfsLocalCustomGateWay(): Promise<string> {
    const loaded = await loadIpfsSettings();
    return loaded.custom.gatewayUrl ?? 'http://127.0.0.1:8080/ipfs';
}