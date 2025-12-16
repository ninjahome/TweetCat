import {create} from 'kubo-rpc-client';
import {
    ERR_LOCAL_IPFS_HANDOFF,
    getCachedIpfsSettings,
    IpfsSettings,
    loadIpfsSettings, PROVIDER_TYPE_CUSTOM, PROVIDER_TYPE_LIGHTHOUSE, PROVIDER_TYPE_PINATA, PROVIDER_TYPE_TWEETCAT,
} from './ipfs_settings';
import {TWEETCAT_PINATA} from "./ipfs_config";
import browser from "webextension-polyfill";
import {decryptString, fetchWithTimeout, openOrUpdateTab, sendMsgToService} from "../common/utils";
import {MsgType} from "../common/consts";

export const DEFAULT_IPFS_API = 'https://ipfs.infura.io:5001/api/v0';
export const PINATA_JSON_ENDPOINT = 'https://api.pinata.cloud/pinning/pinJSONToIPFS';
export const PINATA_FILE_ENDPOINT = 'https://api.pinata.cloud/pinning/pinFileToIPFS';
export const PINATA_GATEWAY = 'https://gateway.pinata.cloud/ipfs';
export const LIGHTHOUSE_UPLOAD_ENDPOINT = 'https://upload.lighthouse.storage/api/v0/add?cid-version=1&pin=true';
export const LIGHTHOUSE_GATEWAY = 'https://gateway.lighthouse.storage/ipfs';
export const PINATA_UNPIN_ENDPOINT = 'https://api.pinata.cloud/pinning/unpin';
export const LIGHTHOUSE_API_BASE = 'https://api.lighthouse.storage';


const PUBLIC_GATEWAYS = [
    (cid: string) => `https://ipfs.io/ipfs/${cid}`,
    (cid: string) => `https://dweb.link/ipfs/${cid}`,
    (cid: string) => `https://${cid}.ipfs.dweb.link/`,
];

let cachedClient: { key: string; client: any } | null = null;
let cachedCustomAuthHeader: string | null = null;


export function tweetcatPinataHeaders(): Record<string, string> {
    if (!TWEETCAT_PINATA.JWT) {
        throw new Error('TweetCat Pinata JWT 未注入');
    }
    return {Authorization: `Bearer ${TWEETCAT_PINATA.JWT}`};
}


function sanitizeGateway(base: string, cid: string): string {
    const trimmed = base.replace(/\/+$/, '');
    return `${trimmed}/${cid}`;
}

export async function ensureSettings(): Promise<IpfsSettings | null> {
    let settings = await getCachedIpfsSettings();
    if (!settings) settings = await loadIpfsSettings();

    if (!settings || settings.provider !== PROVIDER_TYPE_CUSTOM) {
        cachedCustomAuthHeader = null;
    }
    return settings;
}


function assertPassword(password?: string): asserts password is string {
    if (!password) {
        throw new Error('需要输入口令以解密凭据');
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
    if (!settings || settings.provider !== PROVIDER_TYPE_PINATA || !settings.pinata) {
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
    if (!settings || settings.provider !== PROVIDER_TYPE_LIGHTHOUSE || !settings.lighthouse) {
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
    if (!settings || settings.provider !== PROVIDER_TYPE_CUSTOM) {
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

export async function getIpfs(authHeader?: string) {
    const settings = await ensureSettings();
    let url = DEFAULT_IPFS_API;
    let header = authHeader;

    if (settings && settings.provider === PROVIDER_TYPE_CUSTOM && settings.custom?.apiUrl) {
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


export function localUiUrlIfCustom(settings?: IpfsSettings | null): string | null {
    if (!settings || settings.provider !== PROVIDER_TYPE_CUSTOM) return null;
    const api = settings.custom?.apiUrl?.trim();
    if (!api) return null;
    try {
        const u = new URL(api);
        const isLocal = ['localhost', '127.0.0.1', '::1'].includes(u.hostname);
        if (!isLocal) return null;
        // 用用户配置的 origin，别写死端口；加个 hash 方便 content script 识别
        return `${u.protocol}//${u.host}/#tweetcat-ipfs`;
    } catch {
        return null;
    }
}

/** 在可用时直接用 tabs；否则让 SW 代开（content 环境会走这里） */
async function openOrFocus(uiUrl: string): Promise<void> {
    const canUseTabs =
        !!(browser as any)?.tabs &&
        typeof browser.tabs.query === 'function' &&
        typeof browser.tabs.create === 'function' &&
        typeof browser.tabs.update === 'function';

    if (canUseTabs) {
        await openOrUpdateTab(uiUrl);
        return;
    }
    await sendMsgToService(uiUrl, MsgType.OpenOrFocusUrl);
}


export async function uploadJson(settings: IpfsSettings, obj: any, wallet: string, password?: string): Promise<string> {
    const localIpfsNode = localUiUrlIfCustom(settings);
    if (localIpfsNode) {
        await openOrFocus(localIpfsNode + "?wallet=" + wallet);
        throw new Error(ERR_LOCAL_IPFS_HANDOFF);
    }

    const provider = settings?.provider ?? PROVIDER_TYPE_CUSTOM;

    if (provider === PROVIDER_TYPE_TWEETCAT) {
        const headers = {...tweetcatPinataHeaders(), 'Content-Type': 'application/json'};
        const body = JSON.stringify({pinataContent: obj, pinataOptions: {cidVersion: 1}});
        const resp = await fetchWithTimeout(TWEETCAT_PINATA.JSON_ENDPOINT, {method: 'POST', headers, body});
        if (!resp.ok) throw new Error(`Pinata 上传失败: HTTP ${resp.status}`);
        const data = await resp.json();
        const cid = data.IpfsHash || data.cid || data.Hash;
        if (!cid) throw new Error('Pinata 上传成功但未返回 CID');
        return cid;
    }

    if (provider === PROVIDER_TYPE_PINATA) {
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

    if (provider === PROVIDER_TYPE_LIGHTHOUSE) {
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
            const respJson = await resp.json()
            const errMsg= respJson?.details || respJson?.error||""
            throw new Error(`Lighthouse 上传失败: HTTP ${resp.status} ${errMsg}`);
        }
        const data = await resp.json();
        console.log("------>>> light house upload json success:", data);
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
    const provider = settings?.provider ?? PROVIDER_TYPE_CUSTOM;

    if (provider === PROVIDER_TYPE_TWEETCAT) {
        const headers = tweetcatPinataHeaders();
        const form = new FormData();
        form.append('file', file, file.name);
        form.append('pinataOptions', JSON.stringify({cidVersion: 1}));

        const resp = await fetchWithTimeout(TWEETCAT_PINATA.FILE_ENDPOINT, {
            method: 'POST',
            headers,
            body: form,
        }, 60_000);
        if (!resp.ok) throw new Error(`Pinata 上传失败: HTTP ${resp.status}`);
        const data = await resp.json();
        const cid = data.IpfsHash || data.cid || data.Hash;
        if (!cid) throw new Error('Pinata 上传成功但未返回 CID');
        return cid;
    }


    if (provider === PROVIDER_TYPE_PINATA) {
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

    if (provider === PROVIDER_TYPE_LIGHTHOUSE) {
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
    const resp = await fetchWithTimeout(url, {}, 15_000);
    if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
    }
    return await readResponseAsBytes(resp);
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
    const provider = settings?.provider ?? PROVIDER_TYPE_CUSTOM;
    const triedErrors: string[] = [];

    const pushError = (err: Error) => {
        triedErrors.push(err.message);
    };

    if (provider === PROVIDER_TYPE_TWEETCAT) {
        try {
            return await tryFetch(`${TWEETCAT_PINATA.GATEWAY}/${cid}`);
        } catch (err) {
            pushError(err as Error);
        }
    }

    if (provider === PROVIDER_TYPE_PINATA) {
        try {
            return await tryFetch(`${PINATA_GATEWAY}/${cid}`);
        } catch (err) {
            pushError(err as Error);
        }
    } else if (provider === PROVIDER_TYPE_LIGHTHOUSE) {
        try {
            return await tryFetch(`${LIGHTHOUSE_GATEWAY}/${cid}`);
        } catch (err) {
            pushError(err as Error);
        }
    } else if (provider === PROVIDER_TYPE_CUSTOM) {
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

export async function buildGatewayUrls(cid: string): Promise<string[]> {
    const urls: string[] = [];
    const settings = await getCachedIpfsSettings();

    if (settings?.provider === PROVIDER_TYPE_TWEETCAT) {
        urls.push(`${TWEETCAT_PINATA.GATEWAY}/${cid}`);
    } else if (settings?.provider === PROVIDER_TYPE_PINATA) {
        urls.push(`${PINATA_GATEWAY}/${cid}`);
    } else if (settings?.provider === PROVIDER_TYPE_LIGHTHOUSE) {
        urls.push(`${LIGHTHOUSE_GATEWAY}/${cid}`);
    } else if (settings?.provider === PROVIDER_TYPE_CUSTOM && settings.custom?.gatewayUrl) {
        urls.push(sanitizeGateway(settings.custom.gatewayUrl, cid));
    }

    for (const builder of PUBLIC_GATEWAYS) {
        const candidate = builder(cid);
        if (!urls.includes(candidate)) urls.push(candidate);
    }
    return urls;
}


async function unpinFromTweetcatPinata(cid: string): Promise<void> {
    if (!cid) return;

    const origin = (() => {
        try {
            return new URL(TWEETCAT_PINATA.JSON_ENDPOINT).origin;
        } catch {
            return 'https://api.pinata.cloud';
        }
    })();

    const url = `${origin}/pinning/unpin/${encodeURIComponent(cid)}`;
    const headers = tweetcatPinataHeaders();

    const resp = await fetchWithTimeout(url, {
        method: 'DELETE',
        headers,
    }, 10_000);

    if (!resp.ok) {
        throw new Error(`TweetCat Pinata 取消固定失败: HTTP ${resp.status}`);
    }
}

async function unpinFromPinata(settings: IpfsSettings | null, cid: string, password?: string): Promise<void> {
    if (!cid) return;

    const headers = await pinataHeaders(settings, password);
    // DELETE 一般没有 body，不需要 Content-Type，顺便避免某些代理奇怪的问题
    delete (headers as any)['Content-Type'];

    const resp = await fetchWithTimeout(
        `${PINATA_UNPIN_ENDPOINT}/${encodeURIComponent(cid)}`,
        {method: 'DELETE', headers},
        10_000,
    );

    if (!resp.ok) {
        throw new Error(`Pinata 取消固定失败: HTTP ${resp.status}`);
    }
}


async function unpinFromCustom(settings: IpfsSettings, cid: string, password?: string): Promise<void> {
    if (!cid) return;

    const apiUrl = settings.custom?.apiUrl?.trim();
    if (!apiUrl) {
        throw new Error('未配置自建节点 API URL');
    }

    const base = apiUrl.replace(/\/+$/, ''); // 去掉结尾多余的 /
    const search = new URLSearchParams({
        arg: cid,
        recursive: 'true',
    });
    const url = `${base}/pin/rm?${search.toString()}`;

    const headers: Record<string, string> = {};
    const auth = await resolveCustomAuth(settings, password);
    if (auth) {
        headers['Authorization'] = auth;
    }

    const resp = await fetchWithTimeout(url, {
        method: 'POST',
        headers,
    }, 30_000);

    if (!resp.ok) {
        throw new Error(`自建节点取消固定失败: HTTP ${resp.status}`);
    }
}

/** 根据 CID 遍历 files_uploaded 列表，找到所有匹配的 fileId */
async function findLighthouseFileIdsByCid(token: string, cid: string): Promise<string[]> {
    const ids: string[] = [];
    let lastKey: string | null = null;

    // 防御性限制最多翻 20 页，避免意外死循环
    for (let page = 0; page < 20; page++) {
        const params = new URLSearchParams({
            lastKey: lastKey ?? 'null',
        });

        const resp = await fetchWithTimeout(
            `${LIGHTHOUSE_API_BASE}/api/user/files_uploaded?${params.toString()}`,
            {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            },
            15_000,
        );

        if (!resp.ok) {
            throw new Error(`Lighthouse 列表文件失败: HTTP ${resp.status}`);
        }

        const json: any = await resp.json();
        const fileList: any[] = json?.fileList || json?.data?.fileList;
        if (!Array.isArray(fileList) || fileList.length === 0) {
            break;
        }

        console.log("---------light house files:", json, fileList);

        for (const f of fileList) {
            if (f && typeof f.cid === 'string' && f.cid === cid && typeof f.id === 'string') {
                ids.push(f.id);
            }
        }

        const last = fileList[fileList.length - 1];
        if (!last || typeof last.id !== 'string') {
            break;
        }
        lastKey = last.id;
    }

    return ids;
}


async function unpinFromLighthouse(settings: IpfsSettings | null, cid: string, password?: string): Promise<void> {
    if (!cid) return;

    // 复用现有的 lighthouseToken，拿到 API Key / JWT
    const token = await lighthouseToken(settings, password);

    // 先通过 files_uploaded 找到这个 CID 对应的所有 fileId
    const fileIds = await findLighthouseFileIdsByCid(token, cid);
    if (!fileIds.length) {
        console.log('Lighthouse: 未在 files_uploaded 中找到匹配 CID，跳过删除', cid);
        return;
    }

    for (const id of fileIds) {
        const url = `${LIGHTHOUSE_API_BASE}/api/user/delete_file?id=${encodeURIComponent(id)}`;
        const resp = await fetchWithTimeout(
            url,
            {
                method: 'DELETE',
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            },
            15_000,
        );

        if (!resp.ok) {
            // 不直接 throw，避免因为一条删不掉导致整个流程失败
            console.warn('Lighthouse 删除文件失败:', {id, cid, status: resp.status});
        }
    }
}

export async function unpinCid(settings: IpfsSettings | null, cid: string, password?: string): Promise<void> {
    if (!cid) return;

    const provider = settings.provider ?? PROVIDER_TYPE_CUSTOM;

    if (provider === PROVIDER_TYPE_TWEETCAT) {
        await unpinFromTweetcatPinata(cid);
    } else if (provider === PROVIDER_TYPE_PINATA) {
        await unpinFromPinata(settings, cid, password);
    } else if (provider === PROVIDER_TYPE_CUSTOM) {
        await unpinFromCustom(settings, cid, password);
    } else if (provider === PROVIDER_TYPE_LIGHTHOUSE) {
        await unpinFromLighthouse(settings, cid, password);
    } else {
        console.warn('unpinCid: 未知 provider，忽略', provider);
    }
}
