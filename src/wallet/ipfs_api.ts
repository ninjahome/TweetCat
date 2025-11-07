import {ethers} from 'ethers';
import {loadWallet, exportPrivateKey} from "./wallet_api";
import {create} from 'kubo-rpc-client'
import {privateKeyFromRaw} from '@libp2p/crypto/keys'
import {peerIdFromPrivateKey} from "@libp2p/peer-id"
import {__tableIpfsSettings, checkAndInitDatabase, databaseQueryAll, databaseUpdateOrAddItem} from "../common/database";


export interface IPFSSettings {
    useDefault: boolean;          // 勾选后忽略下列自定义项
    apiUrl?: string;              // 例如 https://ipfs.infura.io:5001/api/v0
    projectId?: string;           // Infura Project ID
    projectSecret?: string;       // Infura Project Secret
    gatewayUrl?: string;          // 例如 https://ipfs.io/ipfs
}

const IPFS_SETTINGS_KEY = "default";

export const DEFAULT_IPFS_SETTINGS: IPFSSettings = {
    useDefault: true,
    apiUrl: "https://ipfs.infura.io:5001/api/v0",
    gatewayUrl: "https://ipfs.io/ipfs",
};

export async function loadIpfsSettings(): Promise<IPFSSettings> {
    await checkAndInitDatabase();
    const rows = (await databaseQueryAll(__tableIpfsSettings)) as Array<IPFSSettings & { id: string }>;
    const found = rows.find(r => r.id === IPFS_SETTINGS_KEY);
    return found ? { ...DEFAULT_IPFS_SETTINGS, ...found } : { ...DEFAULT_IPFS_SETTINGS };
}

export async function saveIpfsSettings(s: IPFSSettings): Promise<void> {
    await checkAndInitDatabase();
    const payload = {
        id: IPFS_SETTINGS_KEY,
        useDefault: !!s.useDefault,
        apiUrl: (s.apiUrl ?? "").trim() || DEFAULT_IPFS_SETTINGS.apiUrl,
        projectId: (s.projectId ?? "").trim(),
        projectSecret: (s.projectSecret ?? "").trim(),
        gatewayUrl: (s.gatewayUrl ?? "").trim() || DEFAULT_IPFS_SETTINGS.gatewayUrl,
    };
    await databaseUpdateOrAddItem(__tableIpfsSettings, payload);
    resetIpfsClient(); // 保存后让下次 getIpfs() 重新按新配置初始化
}



let ipfsClient: any | null = null
export function resetIpfsClient() {
    ipfsClient = null;
}

export async function getIpfs() {
    if (!ipfsClient) {
        const s = await loadIpfsSettings();
        const url = (s.useDefault || !s.apiUrl) ? DEFAULT_IPFS_SETTINGS.apiUrl! : s.apiUrl!;
        const headers: Record<string, string> = {};

        // 若填了 Infura 认证，就加 Basic Auth
        if (!s.useDefault && s.projectId && s.projectSecret) {
            const token = btoa(`${s.projectId}:${s.projectSecret}`);
            headers["Authorization"] = `Basic ${token}`;
        }

        ipfsClient = create({
            url,
            headers: Object.keys(headers).length ? headers : undefined,
        });
        console.log(`[IPFS] client initialized @ ${url}${headers.Authorization ? " (auth)" : ""}`);
    }
    return ipfsClient;
}

// ==================== 上传字符串 ====================

export async function uploadString(content: string): Promise<string> {
    const ipfs = await getIpfs()
    const {cid} = await ipfs.add(content)
    return cid.toString()
}

// ==================== 上传 JSON ====================

export async function uploadJson(obj: any): Promise<string> {
    const ipfs =await getIpfs()
    const jsonStr = JSON.stringify(obj)
    const {cid} = await ipfs.add(jsonStr)
    return cid.toString()
}

// ==================== 上传文件（浏览器 File） ====================

export async function uploadFile(file: File): Promise<string> {
    const ipfs = await getIpfs()
    const bytes = new Uint8Array(await file.arrayBuffer())
    const {cid} = await ipfs.add(bytes, {wrapWithDirectory: false})
    return cid.toString()
}

// ==================== 从钱包派生 PeerID ====================
export async function ensureIpfsPeerId(password: string): Promise<string> {

    const wallet = await loadWallet();
    if (!wallet) throw new Error('未找到本地钱包');

    if (wallet.peerId) {            // ① 已有则复用
        return wallet.peerId;
    }

    const privKeyHex = await exportPrivateKey(password); // 返回 "0x..." 或 hex string

    const privKeyBytes = ethers.utils.arrayify(privKeyHex);
    const privateKey = privateKeyFromRaw(privKeyBytes);

    console.log("------>>> convert to ipfs private key!!!");

    const peerId = peerIdFromPrivateKey(privateKey);

    const derivedPeerId = peerId.toString()
    console.log("------>>> creating peer id success:", derivedPeerId);

    return derivedPeerId
}

export async function publishToMyIPNS(ipnsName: string, cid: string): Promise<string> {
    const ipfs = await getIpfs()

    console.log(`[IPNS] 尝试将 CID ${cid} 发布到 IPNS 名称: ${ipnsName}`);

    try {
        const result = await ipfs.name.publish(cid, {
            key: ipnsName, // 使用 Peer ID 字符串作为密钥名称
            lifetime: '24h',
            ttl: '30m'
        });

        console.log(`[IPNS] 发布成功。`);
        console.log(`[IPNS] 最终名称: ${result.name}`);
        console.log(`[IPNS] CID: ${result.value}`);
        return result.name;

    } catch (error) {
        console.error(`[IPNS] 发布失败：`, error);
        console.error(`[IPNS] 失败原因很可能是 Infura 不允许使用外部密钥进行 IPNS 发布。`);
        console.log(`[IPNS] 你需要连接到一个你拥有密钥访问权限的本地运行的 Kubo 节点来完成此操作。`);

        // 尽管发布失败，但我们返回预期的 IPNS 名称
        return ipnsName;
    }
}


export async function testUpload(password: string): Promise<void> {
    const testString = "Hello IPFS from my Ethereum key's Peer ID! Time: " + new Date().toISOString();

    console.log("--- 开始 IPFS/IPNS 测试 ---");

    // 1. 派生 Peer ID
    console.log("1. 派生 Peer ID...");
    // 确保 ensureIpfsPeerId 返回 Peer ID 字符串
    const ipnsName = await ensureIpfsPeerId(password);
    console.log(`[IPFS] 派生成功。Peer ID (IPNS Name): ${ipnsName}`);

    // 2. 上传测试内容到 IPFS，获取 CID
    console.log("2. 上传字符串到 IPFS...");
    const cid = await uploadString(testString);
    console.log(`[IPFS] 内容已上传。CID: ${cid}`);

    // 3. 尝试使用派生的 Peer ID 发布到 IPNS
    console.log("3. 尝试使用派生的 Peer ID 发布到 IPNS...");
    try {
        // 直接传入 Peer ID 和 CID
        const publishedName = await publishToMyIPNS(ipnsName, cid);
        console.log(`--- IPNS/IPFS 测试完成 ---`);
        console.log(`最终 IPNS 名称: ${publishedName}`);
    } catch (e) {
        console.error("测试失败，请检查 IPFS 节点连接。", e);
    }
}