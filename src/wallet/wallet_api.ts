// src/wallet/wallet_api.ts
import {ethers} from "ethers";
import {
    __tableWalletSettings,
    __tableWallets,
    checkAndInitDatabase,
    databaseDelete,
    databaseQueryAll,
    databaseUpdateOrAddItem,
} from "../common/database";
import {
    BASE_MAINNET_CHAIN_ID,
    BASE_MAINNET_DEFAULT_RPC,
    BASE_MAINNET_USDC, BASE_SEPOLIA_CHAIN_ID,
    BASE_SEPOLIA_DEFAULT_RPC,
    BASE_SEPOLIA_USDC
} from "../common/consts";
import {logW} from "../common/debug_flags";
import {ChainNameBaseMain, ChainNameBaseSepolia, ChainNetwork} from "../common/x402_obj";

/** ====== 类型 ====== */
export interface TCWallet {
    address: string;
    keystoreJson: string;
    createdAt: number;
    peerId?: string;
}

export interface WalletSettings {
    infuraProjectId?: string;
    customRpcUrl?: string;
    useDefaultRpc: boolean;

    network: ChainNetwork;
}

const WALLET_SETTINGS_KEY = "default";

export const defaultWalletSettings: WalletSettings = {
    useDefaultRpc: true,
    infuraProjectId: "",
    customRpcUrl: "",

    network: 'base-mainnet',
};

/** ====== 存取（保留你已有的导出） ====== */
export async function saveWallet(record: TCWallet): Promise<void> {
    await checkAndInitDatabase();

    const normalizedAddress = record.address.toLowerCase();
    const payload = {
        address: normalizedAddress,
        keystoreJson: record.keystoreJson,
        createdAt: record.createdAt ?? Date.now(),
        peerId: record.peerId ?? undefined,
    };

    const existing = await databaseQueryAll(__tableWallets);
    await Promise.all(
        existing
            .filter((item: any) => item.address !== normalizedAddress)
            .map((item: any) => databaseDelete(__tableWallets, item.address))
    );

    await databaseUpdateOrAddItem(__tableWallets, payload);
}

export async function loadWallet(): Promise<TCWallet | null> {
    await checkAndInitDatabase();

    const records = (await databaseQueryAll(__tableWallets)) as TCWallet[];
    if (!records || records.length === 0) return null;

    const sorted = [...records].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    const latest = sorted[0];
    return {
        address: latest.address,
        keystoreJson: latest.keystoreJson,
        createdAt: latest.createdAt ?? Date.now(),
        peerId: latest.peerId,
    };
}

export async function clearWallet(address?: string): Promise<void> {
    await checkAndInitDatabase();
    if (address) {
        await databaseDelete(__tableWallets, address.toLowerCase());
        return;
    }
    const records = await databaseQueryAll(__tableWallets);
    await Promise.all(records.map((item: any) => databaseDelete(__tableWallets, item.address)));
}

export async function loadWalletSettings(): Promise<WalletSettings> {
    await checkAndInitDatabase();

    const records = (await databaseQueryAll(__tableWalletSettings)) as Array<WalletSettings & { id: string }>;
    const stored = records.find((item) => item.id === WALLET_SETTINGS_KEY);
    if (!stored) {
        return {...defaultWalletSettings};
    }

    const storedNetwork = (stored as any).network;
    const network: WalletSettings['network'] =
        storedNetwork === ChainNameBaseMain || storedNetwork === ChainNameBaseSepolia
            ? storedNetwork
            : defaultWalletSettings.network;

    return {
        useDefaultRpc: stored.useDefaultRpc ?? defaultWalletSettings.useDefaultRpc,
        infuraProjectId: stored.infuraProjectId ?? "",
        customRpcUrl: stored.customRpcUrl ?? "",
        network,
    };
}

export async function saveWalletSettings(settings: WalletSettings): Promise<void> {
    await checkAndInitDatabase();

    const payload = {
        id: WALLET_SETTINGS_KEY,
        useDefaultRpc: settings.useDefaultRpc,
        infuraProjectId: settings.infuraProjectId?.trim() ?? "",
        customRpcUrl: settings.customRpcUrl?.trim() ?? "",
        network: settings.network,     // ← 新增这一行
    };

    await databaseUpdateOrAddItem(__tableWalletSettings, payload);
}

/** ====== 助记词与加密保存（新增） ====== */
const fromPhrase = (ethers as any).Wallet.fromPhrase || (ethers as any).Wallet.fromMnemonic;
const createRandom = (ethers as any).Wallet.createRandom;

export async function generateMnemonic(words: 12 | 24 = 12): Promise<string> {
    // ethers 自带随机钱包（默认 12 词）。24 词如需严格保证，可接入 bip39；这里先保持 12 词默认。
    const tmp = createRandom();
    const phrase = tmp?.mnemonic?.phrase;
    if (!phrase) throw new Error("无法生成助记词");
    if (words === 24) {
        // 可选：接入 bip39 生成 24 词；此处先返回 12 词，避免额外依赖。
    }
    return phrase;
}

/** 由助记词派生 -> 加密 -> 落库 */
export async function saveFromMnemonic(mnemonic: string, password: string): Promise<string /* address */> {
    const phrase = mnemonic.trim().replace(/\s+/g, " ");
    if (!phrase) throw new Error("助记词为空");
    if (!password || password.length < 8) throw new Error("口令至少 8 位");

    const wallet = fromPhrase(phrase);
    const keystoreJson = await wallet.encrypt(password, {
        kdf: "pbkdf2", pbkdf2: {c: 65536, dklen: 32, prf: "hmac-sha256"}
    });

    const record: TCWallet = {
        address: wallet.address,
        keystoreJson,
        createdAt: Date.now(),
    };
    await saveWallet(record);
    return wallet.address;
}

/** ====== Provider 选择（与 dashboard 保持一致） ====== */
export function getRpcEndpoint(settings: WalletSettings): string {
    const infuraId = settings.infuraProjectId?.trim();
    const custom = settings.customRpcUrl?.trim();

    // 1) 自定义 RPC：useDefaultRpc === false 且 customRpcUrl 有值，优先走这里
    if (!settings.useDefaultRpc && custom) {
        return custom;
    }

    // 2) 配了 Infura 的情况：根据 network 选 base 主网 / 测试网
    if (infuraId) {
        if (settings.network === ChainNameBaseMain) {
            return `https://base-mainnet.infura.io/v3/${infuraId}`;
        } else {
            return `https://base-sepolia.infura.io/v3/${infuraId}`;
        }
    }

    // 3) 否则走默认公共 RPC，直接用你的全局常量
    return settings.network === ChainNameBaseMain
        ? BASE_MAINNET_DEFAULT_RPC
        : BASE_SEPOLIA_DEFAULT_RPC;
}

export function createProvider(settings: WalletSettings) {
    const url = getRpcEndpoint(settings);
    const chainId =
        settings.network === ChainNameBaseMain
            ? BASE_MAINNET_CHAIN_ID
            : BASE_SEPOLIA_CHAIN_ID;

    return new ethers.providers.JsonRpcProvider(url, chainId);
}

/** ====== 余额 & 转账 & 签名 API（可直接给 dashboard 调用） ====== */
// === ethers v5-safe utils ===
const parseUnits = ethers.utils.parseUnits;
const parseEther = ethers.utils.parseEther;
const formatUnits = ethers.utils.formatUnits;
const verifyMessage = ethers.utils.verifyMessage;

// v5 兼容：一些版本没有 utils.verifyTypedData，降级用 _TypedDataEncoder + recoverAddress
function verifyTypedDataCompat(
    domain: any,
    types: any,
    value: any,
    signature: string
): string {
    const u: any = ethers.utils;
    if (typeof u.verifyTypedData === "function") {
        return u.verifyTypedData(domain, types, value, signature);
    }
    const digest = u._TypedDataEncoder.hash(domain, types, value); // bytes32
    const addr = u.recoverAddress(digest, signature);
    return u.getAddress(addr);
}

export async function getEthBalance(address: string, settings?: WalletSettings): Promise<string> {
    const s = settings ?? (await loadWalletSettings());
    const p = createProvider(s);
    const v = await p.getBalance(address);
    // v5: BigNumber; v6: bigint → toString 再格式化
    const raw = (typeof v === "bigint") ? v : (v as any)._hex ? BigInt((v as any)._hex) : BigInt(v.toString());
    return formatUnits(raw, 18);
}

export function getBaseUsdcAddress(settings: WalletSettings): string {
    return settings.network === ChainNameBaseMain
        ? BASE_MAINNET_USDC
        : BASE_SEPOLIA_USDC;
}

export async function getTokenBalance(
    address: string,
    tokenAddress: string,
    settings?: WalletSettings
): Promise<string> {
    if (!address) throw new Error("地址不能为空");
    if (!tokenAddress) throw new Error("代币合约地址不能为空");

    const s = settings ?? (await loadWalletSettings());
    const provider = createProvider(s);

    const abi = [
        "function balanceOf(address owner) view returns (uint256)",
        "function decimals() view returns (uint8)"
    ];

    const contract = new (ethers as any).Contract(tokenAddress, abi, provider);

    const [balanceRaw, decimalsRaw] = await Promise.all([
        contract.balanceOf(address),
        contract.decimals().catch(() => 18),
    ]);

    const raw: bigint =
        typeof balanceRaw === "bigint"
            ? balanceRaw
            : (balanceRaw as any)._hex
                ? BigInt((balanceRaw as any)._hex)
                : BigInt(balanceRaw.toString());

    const decimals: number =
        typeof decimalsRaw === "number"
            ? decimalsRaw
            : Number(decimalsRaw.toString());

    return formatUnits(raw, decimals);
}


export async function transferEth(params: {
    to: string;
    amountEther: string;
    password: string;
    gasLimitWei?: string;
    settings?: WalletSettings;
}): Promise<string /* txHash */> {
    const {to, amountEther, password, gasLimitWei, settings} = params;
    if (!to) throw new Error("接收地址无效");
    if (!amountEther) throw new Error("请输入转账金额");

    const s = settings ?? (await loadWalletSettings());
    const provider = createProvider(s);

    return withDecryptedWallet(password, async (wallet) => {
        const connected = wallet.connect(provider);
        const req: any = {to, value: parseEther(amountEther)};
        if (gasLimitWei) req.gasLimit = (ethers as any).BigNumber?.from?.(gasLimitWei) ?? gasLimitWei;
        const tx = await connected.sendTransaction(req);
        return tx.hash as string;
    });
}

export async function transferErc20(params: {
    tokenAddress: string;
    to: string;
    amount: string;
    decimals: number;
    password: string;
    gasLimitWei?: string;
    settings?: WalletSettings;
}): Promise<string> {
    const {tokenAddress, to, amount, decimals, password, gasLimitWei, settings} = params;
    if (!tokenAddress) throw new Error("代币合约地址无效");
    if (!to) throw new Error("接收地址无效");
    if (!amount) throw new Error("请输入转账数量");

    const s = settings ?? (await loadWalletSettings());
    const provider = createProvider(s);

    return withDecryptedWallet(password, async (wallet) => {
        const connected = wallet.connect(provider);
        const abi = ["function transfer(address to, uint256 amount) returns (bool)"];
        const contract = new (ethers as any).Contract(tokenAddress, abi, connected);
        const value = parseUnits(amount, decimals);
        const tx = await contract.transfer(to, value, gasLimitWei ? {gasLimit: gasLimitWei} : {});
        return tx.hash as string;
    });
}

export async function signMessage(params: { message: string; password: string }): Promise<string> {
    const {message, password} = params;
    if (!message) throw new Error("消息不能为空");
    return withDecryptedWallet(password, async (wallet) => wallet.signMessage(message));
}

export async function signTypedData(params: {
    domain: any; types: any; value: any; password: string;
}): Promise<string> {
    const {domain, types, value, password} = params;
    return withDecryptedWallet(password, async (wallet) => {
        const fn = (wallet as any)._signTypedData || (wallet as any).signTypedData;
        return fn.call(wallet, domain, types, value);
    });
}

export async function verifySignature(params: {
    message?: string;
    typed?: { domain: any; types: any; value: any };
    signature: string;
    expectedAddress?: string;
}): Promise<boolean | string> {
    const {message, typed, signature, expectedAddress} = params;
    if (!signature) throw new Error("缺少签名");

    const recovered = message !== undefined
        ? verifyMessage(message, signature)
        : verifyTypedDataCompat(typed!.domain, typed!.types, typed!.value, signature);

    if (expectedAddress) {
        return recovered.toLowerCase() === expectedAddress.toLowerCase();
    }
    return recovered;
}

// 1. 定义缓存对象和有效期
const CACHE_LIFETIME_MS = 15 * 60 * 1000; // 15 分钟
interface DecryptedWalletCache {
    wallet: ethers.Wallet;
    expires: number;
    address: string;
}

let decryptedWalletCache: DecryptedWalletCache | null = null;

export function lockWallet() {
    decryptedWalletCache = null;
}

export async function withDecryptedWallet<T>(
    password: string,
    action: (wallet: ethers.Wallet) => Promise<T>
): Promise<T> {
    const record = await loadWallet();
    if (!record) throw new Error("未找到本地钱包记录");

    const normalizedAddress = record.address.toLowerCase();

    // --- 缓存检查 ---
    const now = Date.now();
    if (decryptedWalletCache &&
        decryptedWalletCache.address === normalizedAddress &&
        decryptedWalletCache.expires > now
    ) {
        logW("[Wallet] 使用缓存的钱包对象 (Expires:", new Date(decryptedWalletCache.expires).toLocaleTimeString(), ")");
        return action(decryptedWalletCache.wallet);
    }
    // --- 缓存检查结束 ---

    logW("[Wallet] 缓存过期或未命中，开始执行耗时的 fromEncryptedJson...");

    let wallet: ethers.Wallet;
    try {
        // 耗时的解密步骤
        wallet = await ethers.Wallet.fromEncryptedJson(record.keystoreJson, password);
    } catch (error) {
        // 密码错误也会抛出错误
        throw new Error("密码错误或解密失败: " + (error as Error).message);
    }

    // --- 缓存更新 ---
    decryptedWalletCache = {
        wallet,
        expires: now + CACHE_LIFETIME_MS,
        address: normalizedAddress,
    };
    logW("[Wallet] 钱包对象已解密并缓存，有效期至:", new Date(decryptedWalletCache.expires).toLocaleTimeString());

    return action(wallet);
}

export async function exportPrivateKey(password: string): Promise<string> {
    return withDecryptedWallet(password, async (wallet) => wallet.privateKey);
}

export interface WalletStatusResponse {
    status: "NO_WALLET" | "LOCKED" | "UNLOCKED" | "EXPIRED";
    wallet?: ethers.Wallet;
    expiresAt?: number; // 仅 UNLOCKED 时存在
    address?: string;   // 可选，用于 UI 展示
}


export async function walletStatus(): Promise<WalletStatusResponse> {
    const stored = await loadWallet();

    if (!stored) {
        return {status: "NO_WALLET"};
    }

    if (!decryptedWalletCache) {
        return {status: "LOCKED"};
    }
    if (Date.now() > decryptedWalletCache.expires) {
        decryptedWalletCache = null;
        return {status: "EXPIRED"};
    }
    return {
        status: "UNLOCKED",
        wallet:decryptedWalletCache.wallet,
        expiresAt: decryptedWalletCache.expires,
        address: decryptedWalletCache.address,
    };
}
