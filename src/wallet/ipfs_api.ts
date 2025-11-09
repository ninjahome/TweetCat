import {create} from 'kubo-rpc-client';
import {
    decryptString,
    getCachedIpfsSettings,
    IpfsSettings,
    loadIpfsSettings,
} from './ipfs_settings';

const DEFAULT_IPFS_API = 'https://ipfs.infura.io:5001/api/v0';
const PINATA_JSON_ENDPOINT = 'https://api.pinata.cloud/pinning/pinJSONToIPFS';
const PINATA_FILE_ENDPOINT = 'https://api.pinata.cloud/pinning/pinFileToIPFS';
const PINATA_GATEWAY = 'https://gateway.pinata.cloud/ipfs';
const LIGHTHOUSE_UPLOAD_ENDPOINT = 'https://upload.lighthouse.storage/api/v0/add?cid-version=1&pin=true';
const LIGHTHOUSE_GATEWAY = 'https://gateway.lighthouse.storage/ipfs';
const DEFAULT_TIMEOUT = 20_000;

const PUBLIC_GATEWAYS = [
    (cid: string) => `https://ipfs.io/ipfs/${cid}`,
    (cid: string) => `https://dweb.link/ipfs/${cid}`,
    (cid: string) => `https://${cid}.ipfs.dweb.link/`,
];

let cachedClient: { key: string; client: any } | null = null;
let cachedCustomAuthHeader: string | null = null;
let settingsCache: IpfsSettings | null = null;

function sanitizeGateway(base: string, cid: string): string {
    const trimmed = base.replace(/\/+$/, '');
    return `${trimmed}/${cid}`;
}

async function ensureSettings(): Promise<IpfsSettings | null> {
    const cached = getCachedIpfsSettings();
    if (cached) {
        settingsCache = cached;
        return cached;
    }
    const loaded = await loadIpfsSettings();
    settingsCache = loaded;
    if (!loaded || loaded.provider !== 'custom') {
        cachedCustomAuthHeader = null;
    }
    return loaded;
}

function assertPassword(password?: string): asserts password is string {
    if (!password) {
        throw new Error('需要输入口令以解密凭据');
    }
}

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeout = DEFAULT_TIMEOUT): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
        const resp = await fetch(url, {...options, signal: controller.signal});
        return resp;
    } finally {
        clearTimeout(timer);
    }
}

async function readResponseAsBytes(resp: Response): Promise<Uint8Array> {
    if (!resp.ok) {
        throw new Error(`下载失败: HTTP ${resp.status}`);
    }
    const buffer = await resp.arrayBuffer();
    return new Uint8Array(buffer);
}

async function pinataHeaders(settings: IpfsSettings | null, password?: string): Promise<Record<string, string>> {
    if (!settings || settings.provider !== 'pinata' || !settings.pinata) {
        throw new Error('尚未配置 Pinata 凭据');
    }

    const {jwtEnc, apiKeyEnc, secretEnc} = settings.pinata;

    if (jwtEnc) {
        assertPassword(password);
        const token = await decryptString(jwtEnc, password);
        return {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        };
    }

    if (apiKeyEnc && secretEnc) {
        assertPassword(password);
        const apiKey = await decryptString(apiKeyEnc, password);
        const secret = await decryptString(secretEnc, password);
        return {
            'Content-Type': 'application/json',
            pinata_api_key: apiKey,
            pinata_secret_api_key: secret,
        };
    }

    throw new Error('未找到可用的 Pinata 凭据');
}

async function pinataHeadersForFile(settings: IpfsSettings | null, password?: string): Promise<Record<string, string>> {
    const headers = await pinataHeaders(settings, password);
    // Content-Type 由 FormData 生成，移除预设
    delete headers['Content-Type'];
    return headers;
}

async function lighthouseToken(settings: IpfsSettings | null, password?: string): Promise<string> {
    if (!settings || settings.provider !== 'lighthouse' || !settings.lighthouse) {
        throw new Error('尚未配置 Lighthouse 凭据');
    }
    const {jwtEnc, apiKeyEnc} = settings.lighthouse;
    if (jwtEnc) {
        assertPassword(password);
        return decryptString(jwtEnc, password);
    }
    if (apiKeyEnc) {
        assertPassword(password);
        return decryptString(apiKeyEnc, password);
    }
    throw new Error('未找到可用的 Lighthouse 凭据');
}

async function resolveCustomAuth(settings: IpfsSettings | null, password?: string): Promise<string | undefined> {
    if (!settings || settings.provider !== 'custom') {
        cachedCustomAuthHeader = null;
        return undefined;
    }
    const enc = settings.custom?.authEnc;
    if (!enc) {
        cachedCustomAuthHeader = null;
        return undefined;
    }
    if (cachedCustomAuthHeader) {
        return cachedCustomAuthHeader;
    }
    assertPassword(password);
    const header = await decryptString(enc, password);
    cachedCustomAuthHeader = header;
    return header;
}

export function resetIpfsClient(): void {
    cachedClient = null;
    cachedCustomAuthHeader = null;
}

export async function prepareCustomClient(password: string): Promise<void> {
    const settings = await ensureSettings();
    if (!settings || settings.provider !== 'custom') return;
    const auth = await resolveCustomAuth(settings, password);
    await getIpfs(auth);
}

export async function getIpfs(authHeader?: string) {
    const settings = await ensureSettings();
    let url = DEFAULT_IPFS_API;
    let header = authHeader;

    if (settings && settings.provider === 'custom' && settings.custom?.apiUrl) {
        url = settings.custom.apiUrl;
        if (!header && cachedCustomAuthHeader) {
            header = cachedCustomAuthHeader;
        }
    } else {
        cachedCustomAuthHeader = null;
    }

    const key = `${url}::${header ?? ''}`;
    if (!cachedClient || cachedClient.key !== key) {
        cachedClient = {
            key,
            client: create({
                url,
                headers: header ? {Authorization: header} : undefined,
            }),
        };
        console.log(`[IPFS] client initialized @ ${url}${header ? ' (auth)' : ''}`);
    }
    return cachedClient.client;
}

async function ipfsAddBytes(bytes: Uint8Array, options?: any, authHeader?: string): Promise<string> {
    const ipfs = await getIpfs(authHeader);
    const result = await ipfs.add(bytes, options);
    return result.cid.toString();
}

export async function uploadJson(obj: any, password?: string): Promise<string> {
    const settings = await ensureSettings();
    const provider = settings?.provider ?? 'custom';

    if (provider === 'pinata') {
        const headers = await pinataHeaders(settings, password);
        const body = JSON.stringify({
            pinataContent: obj,
            pinataOptions: {cidVersion: 1},
        });
        const resp = await fetchWithTimeout(PINATA_JSON_ENDPOINT, {
            method: 'POST',
            headers,
            body,
        });
        if (!resp.ok) {
            throw new Error(`Pinata 上传失败: HTTP ${resp.status}`);
        }
        const data = await resp.json();
        const cid = data.IpfsHash || data.cid || data.Hash;
        if (!cid) {
            throw new Error('Pinata 上传成功但未返回 CID');
        }
        return cid;
    }

    if (provider === 'lighthouse') {
        const token = await lighthouseToken(settings, password);
        const form = new FormData();
        const blob = new Blob([JSON.stringify(obj)], {type: 'application/json'});
        form.append('file', blob, 'data.json');
        const resp = await fetchWithTimeout(LIGHTHOUSE_UPLOAD_ENDPOINT, {
            method: 'POST',
            headers: {Authorization: `Bearer ${token}`},
            body: form,
        }, 30_000);
        if (!resp.ok) {
            throw new Error(`Lighthouse 上传失败: HTTP ${resp.status}`);
        }
        const data = await resp.json();
        const cid = data.Hash || data.cid || data.data?.Hash;
        if (!cid) {
            throw new Error('Lighthouse 上传成功但未返回 CID');
        }
        return cid;
    }

    const auth = await resolveCustomAuth(settings, password);
    const bytes = new TextEncoder().encode(typeof obj === 'string' ? obj : JSON.stringify(obj));
    return ipfsAddBytes(bytes, undefined, auth);
}

export async function uploadFile(file: File, password?: string): Promise<string> {
    const settings = await ensureSettings();
    const provider = settings?.provider ?? 'custom';

    if (provider === 'pinata') {
        const headers = await pinataHeadersForFile(settings, password);
        const form = new FormData();
        form.append('file', file, file.name);
        form.append('pinataOptions', JSON.stringify({cidVersion: 1}));
        const resp = await fetchWithTimeout(PINATA_FILE_ENDPOINT, {
            method: 'POST',
            headers,
            body: form,
        }, 60_000);
        if (!resp.ok) {
            throw new Error(`Pinata 上传失败: HTTP ${resp.status}`);
        }
        const data = await resp.json();
        const cid = data.IpfsHash || data.cid || data.Hash;
        if (!cid) {
            throw new Error('Pinata 上传成功但未返回 CID');
        }
        return cid;
    }

    if (provider === 'lighthouse') {
        const token = await lighthouseToken(settings, password);
        const form = new FormData();
        form.append('file', file, file.name || 'file');
        const resp = await fetchWithTimeout(LIGHTHOUSE_UPLOAD_ENDPOINT, {
            method: 'POST',
            headers: {Authorization: `Bearer ${token}`},
            body: form,
        }, 60_000);
        if (!resp.ok) {
            throw new Error(`Lighthouse 上传失败: HTTP ${resp.status}`);
        }
        const data = await resp.json();
        const cid = data.Hash || data.cid || data.data?.Hash;
        if (!cid) {
            throw new Error('Lighthouse 上传成功但未返回 CID');
        }
        return cid;
    }

    const auth = await resolveCustomAuth(settings, password);
    const buffer = await file.arrayBuffer();
    return ipfsAddBytes(new Uint8Array(buffer), {wrapWithDirectory: false}, auth);
}

async function tryFetch(url: string): Promise<Uint8Array> {
    try {
        const resp = await fetchWithTimeout(url, {}, 15_000);
        if (!resp.ok) {
            throw new Error(`HTTP ${resp.status}`);
        }
        return await readResponseAsBytes(resp);
    } catch (err) {
        throw new Error(`从网关 ${url} 下载失败: ${(err as Error).message}`);
    }
}

async function catFromNode(cid: string, settings: IpfsSettings | null): Promise<Uint8Array> {
    const auth = await resolveCustomAuth(settings);
    const ipfs = await getIpfs(auth);
    const chunks: Uint8Array[] = [];
    for await (const chunk of ipfs.cat(cid)) {
        const arr = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
        chunks.push(arr);
    }
    if (chunks.length === 0) {
        return new Uint8Array();
    }
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const result = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }
    return result;
}

export async function download(cid: string): Promise<Uint8Array> {
    if (!cid) throw new Error('CID 不能为空');
    const settings = await ensureSettings();
    const provider = settings?.provider ?? 'custom';
    const triedErrors: string[] = [];

    const pushError = (err: Error) => {
        triedErrors.push(err.message);
    };

    if (provider === 'pinata') {
        try {
            return await tryFetch(`${PINATA_GATEWAY}/${cid}`);
        } catch (err) {
            pushError(err as Error);
        }
    } else if (provider === 'lighthouse') {
        try {
            return await tryFetch(`${LIGHTHOUSE_GATEWAY}/${cid}`);
        } catch (err) {
            pushError(err as Error);
        }
    } else if (provider === 'custom') {
        if (settings?.custom?.gatewayUrl) {
            try {
                return await tryFetch(sanitizeGateway(settings.custom.gatewayUrl, cid));
            } catch (err) {
                pushError(err as Error);
            }
        }
        try {
            return await catFromNode(cid, settings);
        } catch (err) {
            pushError(err as Error);
        }
    }

    for (const builder of PUBLIC_GATEWAYS) {
        try {
            return await tryFetch(builder(cid));
        } catch (err) {
            pushError(err as Error);
        }
    }

    throw new Error(`下载失败：${triedErrors.join('；')}`);
}

export function buildGatewayUrls(cid: string): string[] {
    const urls: string[] = [];
    const settings = settingsCache ?? getCachedIpfsSettings();
    if (settings?.provider === 'pinata') {
        urls.push(`${PINATA_GATEWAY}/${cid}`);
    } else if (settings?.provider === 'lighthouse') {
        urls.push(`${LIGHTHOUSE_GATEWAY}/${cid}`);
    } else if (settings?.provider === 'custom' && settings.custom?.gatewayUrl) {
        urls.push(sanitizeGateway(settings.custom.gatewayUrl, cid));
    }
    for (const builder of PUBLIC_GATEWAYS) {
        const candidate = builder(cid);
        if (!urls.includes(candidate)) {
            urls.push(candidate);
        }
    }
    return urls;
}
