import {fetchWithTimeout} from "../common/utils";
import {TWEETCAT_PINATA} from "./ipfs_config";
import {tweetcatPinataHeaders} from "./ipfs_api";
import {SNAPSHOT_TYPE} from "../common/consts";

// ---------- 类型 ----------
export type ManifestItem = { type: string; cid: string };
export type ManifestV1 = { version: 1; updatedAt: number; items: ManifestItem[] };

// ---------- 校验/构建 ----------
function isManifestV1(x: any): x is ManifestV1 {
    return !!x &&
        x.version === 1 &&
        typeof x.updatedAt === "number" &&
        Array.isArray(x.items) &&
        x.items.every((it: any) => it && typeof it.type === "string" && typeof it.cid === "string");
}

function emptyManifest(): ManifestV1 {
    return {version: 1, updatedAt: Date.now(), items: []};
}

/** 覆盖同 type（只保留一条最新），并去重同 CID */
export function buildNextManifest(prev: ManifestV1 | null | undefined, item: ManifestItem): ManifestV1 {
    const base = isManifestV1(prev) ? prev : emptyManifest();
    const filtered = base.items.filter(it => it.type !== item.type && it.cid !== item.cid);
    return {version: 1, updatedAt: Date.now(), items: [item, ...filtered]};
}

// ---------- Pinata 端点（从你现有配置推导） ----------
const PINATA_API_ORIGIN = (() => {
    try {
        return new URL(TWEETCAT_PINATA.JSON_ENDPOINT).origin;
    } catch {
        return "https://api.pinata.cloud";
    }
})();
const JSON_ENDPOINT = TWEETCAT_PINATA.JSON_ENDPOINT || `${PINATA_API_ORIGIN}/pinning/pinJSONToIPFS`;
const LIST_ENDPOINT = `${PINATA_API_ORIGIN}/data/pinList`;
const UNPIN_BASE = `${PINATA_API_ORIGIN}/pinning/unpin`;
const GATEWAY_BASE = (TWEETCAT_PINATA.GATEWAY || "https://gateway.pinata.cloud/ipfs").replace(/\/+$/, "");

// ---------- 原子操作 ----------
/** 上传 JSON（name=walletLower，带最小 keyvalues 标识） -> 返回新 CID */
async function pinJSONForWallet(walletLower: string, manifest: ManifestV1): Promise<string> {
    const headers = {...tweetcatPinataHeaders(), "Content-Type": "application/json"};
    const body = JSON.stringify({
        pinataMetadata: {name: walletLower, keyvalues: {kind: "wallet-manifest", schema: "v1"}},
        pinataOptions: {cidVersion: 1},
        pinataContent: manifest,
    });
    const resp = await fetchWithTimeout(JSON_ENDPOINT, {method: "POST", headers, body});
    if (!resp.ok) throw new Error(`Pinata 上传失败: HTTP ${resp.status}`);
    const data = await resp.json();
    const cid = data.IpfsHash || data.cid || data.Hash;
    if (!cid) throw new Error("Pinata 上传成功但未返回 CID");
    return String(cid);
}

/** 按 name=walletLower 查询“最新一条” -> CID 或 null */
async function pinListLatestByName(walletLower: string): Promise<string | null> {
    const headers = {...tweetcatPinataHeaders()};
    const q = new URLSearchParams();
    q.set("status", "pinned");
    q.set("metadata[name]", walletLower);
    q.set("pageLimit", "1");
    q.set("pageOffset", "0");
    q.set("sortBy", "PINNED_AT");
    q.set("order", "DESC");
    // 防止同名污染（可留可去）
    q.set("metadata[keyvalues]", JSON.stringify({kind: {value: "wallet-manifest", op: "eq"}}));

    const resp = await fetchWithTimeout(`${LIST_ENDPOINT}?${q.toString()}`, {headers});
    if (!resp.ok) throw new Error(`Pinata 查询失败: HTTP ${resp.status}`);
    const data = await resp.json();
    return data?.rows?.[0]?.ipfs_pin_hash || null;
}

/** 列出同名全部 CID（用于删旧） */
async function pinListAllByName(walletLower: string): Promise<string[]> {
    const headers = {...tweetcatPinataHeaders()};
    const q = new URLSearchParams();
    q.set("status", "pinned");
    q.set("metadata[name]", walletLower);
    q.set("pageLimit", "1000");
    q.set("pageOffset", "0");
    q.set("sortBy", "PINNED_AT");
    q.set("order", "DESC");
    q.set("metadata[keyvalues]", JSON.stringify({kind: {value: "wallet-manifest", op: "eq"}}));

    const resp = await fetchWithTimeout(`${LIST_ENDPOINT}?${q.toString()}`, {headers});
    if (!resp.ok) throw new Error(`Pinata 查询失败: HTTP ${resp.status}`);
    const data = await resp.json();
    return (data?.rows ?? []).map((r: any) => r?.ipfs_pin_hash).filter(Boolean);
}

/** 删除单个 CID（忽略失败） */
async function unpin(cid: string): Promise<void> {
    const headers = {...tweetcatPinataHeaders()};
    try {
        await fetchWithTimeout(`${UNPIN_BASE}/${cid}`, {method: "DELETE", headers});
    } catch {
    }
}

/** 网关读 JSON */
async function fetchJsonByCid<T = any>(cid: string): Promise<T> {
    const resp = await fetchWithTimeout(`${GATEWAY_BASE}/${cid}`, {method: "GET"});
    if (!resp.ok) throw new Error(`Pinata 网关失败: HTTP ${resp.status}`);
    return (await resp.json()) as T;
}

// ---------- 对外 API ----------
/** 读取 Manifest；没有则返回 null */
export async function getManifest(walletAddress: string): Promise<ManifestV1 | null> {
    const w = walletAddress.toLowerCase();
    const cid = await pinListLatestByName(w);
    if (!cid) return null;
    const json = await fetchJsonByCid<ManifestV1>(cid).catch(() => null);
    return isManifestV1(json) ? json : null;
}

/** 写入（发布）Manifest：上传新 -> 删旧（同名）-> 返回新 CID */
export async function putManifest(walletAddress: string, manifest: ManifestV1): Promise<string> {
    const w = walletAddress.toLowerCase();
    if (!isManifestV1(manifest)) throw new Error("invalid manifest payload");

    const newCid = await pinJSONForWallet(w, manifest);
    const all = await pinListAllByName(w);
    await Promise.all(all.filter(cid => cid !== newCid).map(unpin));

    return newCid;
}

export async function updateFollowingSnapshot(
    walletAddress: string,
    snapshotCid: string
): Promise<{ manifest: ManifestV1; cid: string; oldSnapshotCids: string[] }> {
    const prev = await getManifest(walletAddress).catch(() => null);

    if (isManifestV1(prev)) {
        const existing = prev.items.find(it => it.type === SNAPSHOT_TYPE);
        if (existing && existing.cid === snapshotCid) {
            console.log("------>>> same cid, no need update ipfs node:", snapshotCid);
            return {manifest: prev, cid: snapshotCid, oldSnapshotCids: []};
        }
    }

    const oldSnapshotCids =
        isManifestV1(prev)
            ? prev.items
                .filter(it => it.type === SNAPSHOT_TYPE && it.cid !== snapshotCid)
                .map(it => it.cid)
            : [];

    const next = buildNextManifest(prev, {type: SNAPSHOT_TYPE, cid: snapshotCid});
    const cid = await putManifest(walletAddress, next);
    return {manifest: next, cid, oldSnapshotCids};
}
