import { base, baseSepolia } from 'viem/chains'
import {
    Address,
    bytesToHex,
    createPublicClient,
    encodeFunctionData,
    formatEther,
    formatUnits,
    getAddress,
    http,
    isAddress,
    isHex,
    padHex,
    parseEther,
    parseUnits,
    toHex,
} from 'viem'
import { ChainIDBaseMain, ChainIDBaseSepolia, initCDP, walletInfo, X402_FACILITATORS } from "../common/x402_obj";
import { getChainId } from "./wallet_setting";
import {
    EndUserEvmAccount,
    EndUserEvmSmartAccount,
    EvmAddress,
    exportEvmAccount,
    getCurrentUser,
    isSignedIn,
    sendEvmTransaction,
    sendUserOperation,
    signEvmTypedData
} from "@coinbase/cdp-core";
import { ClientEvmSigner } from "@x402/evm";
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { privateKeyToAccount } from "viem/accounts";
import { logX402 } from "../common/debug_flags";
import { t } from "../common/i18n";
import { AdDeployer } from "../web3/AdDeployer";
import { signDeviceRequestV2 } from "../common/device_key";

const ERC20_BALANCE_ABI = [
    {
        name: 'balanceOf',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'account', type: 'address' }],
        outputs: [{ type: 'uint256' }],
    },
] as const

const USDC_ABI = [{
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ type: "bool" }],
}] as const;

// ============ 链配置工具函数 ============
function getChain(chainId: number) {
    if (chainId === ChainIDBaseMain) return base;
    if (chainId === ChainIDBaseSepolia) return baseSepolia;
    throw new Error(`Unsupported chain: ${chainId}`);
}

export function getPublicClient(chainId: number) {
    return createPublicClient({ chain: getChain(chainId), transport: http() });
}

export function getCdpNetwork(chainId: number): "base" | "base-sepolia" {
    switch (chainId) {
        case 8453:
            return "base";
        case 84532:
            return "base-sepolia";
        default:
            throw new Error(`Unsupported chainId for CDP: ${chainId}`);
    }
}

// ============ CDP 账户管理 ============
export async function getEOA(): Promise<EndUserEvmAccount> {
    await initCDP();
    if (!await isSignedIn()) throw new Error("Not signed in");

    const user = await getCurrentUser();
    const eoa = user.evmAccountObjects?.[0];
    if (!eoa) {
        throw new Error("EOA account not found");
    }
    return eoa;
}

export async function getSmart(): Promise<EndUserEvmSmartAccount> {
    await initCDP();
    if (!await isSignedIn()) throw new Error("Not signed in");

    const user = await getCurrentUser();
    const sa = user.evmSmartAccountObjects?.[0];
    if (!sa) {
        throw new Error("Smart Account not found");
    }
    return sa;
}

export async function getWalletAddress(): Promise<string | null> {
    try {
        const eoa = await getEOA();
        return eoa.address;
    } catch (e) {
        return null;
    }
}

// 获取 CDP 用户 ID
export async function queryCdpUserID(): Promise<string | null> {
    try {
        await initCDP();
        if (!await isSignedIn()) return null;

        const user = await getCurrentUser();
        return user.userId || null;
    } catch (e) {
        console.error('Failed to get CDP user ID:', e);
        return null;
    }
}

// ============ 余额查询 ============
export async function queryWalletBalance(
    address: string,
    networkId: number,
) {
    if (!address) {
        throw new Error('Invalid address');
    }

    const facilitator = X402_FACILITATORS[networkId];
    if (!facilitator) {
        throw new Error(`No facilitator config for networkId=${networkId}`);
    }

    const client = getPublicClient(networkId);

    // ETH 余额
    const ethRaw = await client.getBalance({
        address: address as `0x${string}`,
    });

    // USDC 余额
    const usdcRaw = await client.readContract({
        address: facilitator.usdcAddress as `0x${string}`,
        abi: ERC20_BALANCE_ABI,
        functionName: 'balanceOf',
        args: [address as `0x${string}`],
        authorizationList: undefined,
    }) as bigint;

    return {
        eth: Number(formatEther(ethRaw)).toFixed(6),
        usdc: formatUnits(usdcRaw, 6),
    };
}

export async function queryCdpWalletInfo(chainId: number | null = null): Promise<walletInfo> {
    const failedWallet = { address: "", ethVal: "", usdcVal: "", hasCreated: false, chainId: -1, xId: null };
    try {
        if (!chainId) chainId = await getChainId();

        await initCDP();
        if (!await isSignedIn()) return failedWallet;

        const user = await getCurrentUser();
        const eoa = user.evmAccountObjects?.[0];
        if (!eoa) {
            return failedWallet;
        }

        const { eth, usdc } = await queryWalletBalance(eoa.address, chainId);
        const xId = user?.authenticationMethods?.x?.sub || null;
        const username = user?.authenticationMethods?.x?.username
        console.log("----->>> query wallet infor for:", chainId, " wallet:", eoa, " x info:", user?.authenticationMethods?.x)

        return {
            address: eoa.address,
            ethVal: eth,
            usdcVal: usdc,
            hasCreated: true,
            chainId,
            xId,
            username
        };
    } catch (error) {
        console.warn('Failed to query CDP wallet info:', error);
        return failedWallet;
    }
}

// ============ Smart Account 转账 ============
export async function transferUSDCSmart(
    chainId: number,
    toAddress: string,
    amountUsdc: string
): Promise<`0x${string}`> {
    if (!isAddress(toAddress)) {
        throw new Error(`Invalid recipient address: ${toAddress}`);
    }
    const to = getAddress(toAddress);

    const smartAccount = await getSmart();
    const usdcAddress = X402_FACILITATORS[chainId].usdcAddress as Address;

    const data = encodeFunctionData({
        abi: USDC_ABI,
        functionName: "transfer",
        args: [to, parseUnits(amountUsdc, 6)],
    });

    const result = await sendUserOperation({
        evmSmartAccount: smartAccount.address as EvmAddress,
        network: getCdpNetwork(chainId),
        calls: [
            {
                to: usdcAddress,
                value: 0n,
                data,
            },
        ],
    });

    return result.userOperationHash as `0x${string}`;
}

export async function transferETHSmart(
    chainId: number,
    toAddress: string,
    amountEth: string
): Promise<`0x${string}`> {
    if (!isAddress(toAddress)) {
        throw new Error(`Invalid recipient address: ${toAddress}`);
    }
    const to = getAddress(toAddress);

    const smartAccount = await getSmart();

    const result = await sendUserOperation({
        evmSmartAccount: smartAccount.address as EvmAddress,
        network: getCdpNetwork(chainId),
        calls: [
            {
                to,
                value: parseEther(amountEth),
                data: "0x",
            },
        ],
    });

    return result.userOperationHash as `0x${string}`;
}

// ============ EOA 转账 ============
export async function transferETHEoa(
    chainId: number,
    toAddress: string,
    amountEth: string
): Promise<`0x${string}`> {
    if (!isAddress(toAddress)) {
        throw new Error(`Invalid recipient address: ${toAddress}`);
    }
    const to = getAddress(toAddress);

    const eoa = await getEOA();

    const result = await sendEvmTransaction({
        evmAccount: eoa.address as EvmAddress,
        network: getCdpNetwork(chainId),
        transaction: {
            to,
            value: parseEther(amountEth),
            chainId: chainId,
            type: "eip1559",
        },
    });

    return result.transactionHash as `0x${string}`;
}

export async function transferUSDCEoa(
    chainId: number,
    toAddress: string,
    amountUsdc: string
): Promise<`0x${string}`> {
    if (!isAddress(toAddress)) {
        throw new Error(`Invalid recipient address: ${toAddress}`);
    }
    const to = getAddress(toAddress);

    const eoa = await getEOA();
    const usdcAddress = X402_FACILITATORS[chainId].usdcAddress as Address;

    const data = encodeFunctionData({
        abi: USDC_ABI,
        functionName: "transfer",
        args: [to, parseUnits(amountUsdc, 6)],
    });

    const result = await sendEvmTransaction({
        evmAccount: eoa.address as EvmAddress,
        network: getCdpNetwork(chainId),
        transaction: {
            to: usdcAddress,
            value: 0n,
            data,
            chainId: chainId,
            type: "eip1559",
        },
    });

    return result.transactionHash as `0x${string}`;
}


export async function transferUSDCByX402(
    chainId: number,
    toAddress: string,
    amountUsdc: string
): Promise<`0x${string}`> {
    if (!isAddress(toAddress)) {
        throw new Error(`Invalid recipient address: ${toAddress}`);
    }
    const result = await postToX402Srv("/usdc-transfer", { amount: amountUsdc, to: toAddress })
    const txHash = result.txHash;
    logX402("-------x402>>>transfer result,", result)
    return txHash;
}

export async function initX402Client(): Promise<typeof fetch> {
    await initCDP();

    const chainId = await getChainId();
    const chain = getChain(chainId);
    const eoa = await getEOA();
    const eoaAddress = eoa.address as unknown as EvmAddress;

    const signer: ClientEvmSigner = {
        address: eoa.address as `0x${string}`,
        signTypedData: async (args: any): Promise<`0x${string}`> => {
            const normalized = normalizeTypedDataForCdp({
                domain: args.domain,
                types: args.types,
                primaryType: args.primaryType,
                message: args.message,
            });
            const res = await signEvmTypedData({
                evmAccount: eoaAddress,
                typedData: {
                    domain: normalized.domain,
                    types: normalized.types,
                    primaryType: normalized.primaryType,
                    message: normalized.message,
                },
            });

            return res.signature as `0x${string}`;
        },
    };

    const client = new x402Client();
    registerExactEvmScheme(client, {
        signer,
        networks: [`eip155:${chain.id}`],
    });

    return wrapFetchWithPayment(fetch, client);
}

type Eip712Field = { name: string; type: string };
type Eip712Types = Record<string, readonly Eip712Field[]>;

function normalizeTypedDataForCdp(args: {
    domain: any;
    types: Eip712Types;
    primaryType: string;
    message: Record<string, any>;
}) {
    const domain = { ...args.domain };

    if (domain.chainId) domain.chainId = Number(domain.chainId);

    const types: Record<string, readonly Eip712Field[]> = { ...(args.types || {}) };
    if (!types.EIP712Domain) {
        types.EIP712Domain = buildEip712DomainTypes(domain);
    }

    const message = { ...args.message };
    const fields = (types?.[args.primaryType] ?? []) as readonly Eip712Field[];
    const typeByName = new Map(fields.map((f) => [f.name, f.type] as const));

    for (const [k, v] of Object.entries(message)) {
        message[k] = normalizeEip712Value(v, typeByName.get(k));
    }

    return { ...args, domain, types, message };
}

function normalizeEip712Value(value: any, typeHint?: string): any {
    if (typeof value === 'bigint') {
        return value.toString();
    }

    if (value instanceof Uint8Array) {
        const hex = bytesToHex(value);
        return typeHint === 'bytes32' ? padHex(hex, { size: 32 }) : hex;
    }

    if (typeof value === 'number') {
        if (typeHint === 'bytes32') {
            return padHex(toHex(BigInt(value)), { size: 32 });
        }
        return value;
    }

    if (typeof value === 'string') {
        if (typeHint === 'bytes32') {
            if (isHex(value)) {
                return padHex(value, { size: 32 });
            }
            try {
                return padHex(toHex(BigInt(value)), { size: 32 });
            } catch {
                return value;
            }
        }
        if (typeHint === 'uint256' && isHex(value)) {
            try {
                return BigInt(value).toString();
            } catch {
                return value;
            }
        }
        return value;
    }

    return value;
}

function buildEip712DomainTypes(domain: any): Eip712Field[] {
    const fields: Eip712Field[] = [];

    if (domain?.name != null) fields.push({ name: "name", type: "string" });
    if (domain?.version != null) fields.push({ name: "version", type: "string" });
    if (domain?.chainId != null) fields.push({ name: "chainId", type: "uint256" });
    if (domain?.verifyingContract != null) fields.push({ name: "verifyingContract", type: "address" });
    if (domain?.salt != null) fields.push({ name: "salt", type: "bytes32" });

    return fields.length ? fields : [{ name: "chainId", type: "uint256" }];
}

/**
 * ⚠️ SECURITY WARNING
 * This exports the EOA private key from Coinbase CDP Core SDK. Do NOT use for production API auth.
 * Keep for temporary testing/debugging only.
 */
export async function getPrivateKeyFromEOA(): Promise<`0x${string}`> {
    const eoa = await getEOA();

    const exportResult = await exportEvmAccount({
        evmAccount: eoa.address as `0x${string}`
    });

    let rawKey = exportResult.privateKey;
    if (!rawKey.startsWith('0x')) {
        rawKey = `0x${rawKey}`;
    }
    return rawKey as `0x${string}`;
}

/**
 * ⚠️ SECURITY WARNING
 * Uses an exported EOA private key to initialize an x402 client. Do NOT use for production API auth.
 * Keep for temporary testing/debugging only.
 */
export async function initX402ClientWithPrivateKey(): Promise<typeof fetch> {
    const rawKey = await getPrivateKeyFromEOA();
    const account = privateKeyToAccount(rawKey as `0x${string}`);
    const client = new x402Client();
    const chainId = await getChainId();
    registerExactEvmScheme(client, {
        signer: account as any,
        networks: [`eip155:${chainId}`],
    });
    return wrapFetchWithPayment(fetch, client);
}

export async function postToX402Srv(path: string, body: any) {
    const chainId = await getChainId();
    const endPoint = X402_FACILITATORS[chainId].endpoint + path;

    const x402Fetch = await initX402Client();
    const response = await x402Fetch(endPoint, {
        method: 'POST',
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const text = await response.text();
        logX402("------>>>x402 error:", text);
        throw new Error(`${t('post_payment_failure')} (${response.status}): ${text}`)
    }

    return await response.json();
}

const signedOperationPaths: string[] = [
    "/ads/publisher/create",
    "/ads/publisher/update",
    "/ads/executor/claim",
    "/ads/publisher/withdraw"
];

export async function x402WorkerFetch(path: string, body: any): Promise<any> {
    const chainID = await getChainId();
    const url = X402_FACILITATORS[chainID].endpoint + path;
    let requestBody = body;
    let bodyText = "";

    const headers: Record<string, string> = {
        "Content-Type": "application/json",
    };

    if (signedOperationPaths.includes(path)) {
        const userId = await queryCdpUserID();
        if (!userId) throw new Error("User not signed in");

        requestBody = {
            ...body,
            userId: userId,
        };

        bodyText = JSON.stringify(requestBody);
        const bodyBytes = new TextEncoder().encode(bodyText);
        const { signatureB64u, iatSec, jti, bodySha256B64u } = await signDeviceRequestV2({
            method: "POST",
            url,
            bodyBytes,
        });

        headers["X-Device-Signature-Version"] = "v2";
        headers["X-Device-IAT"] = String(iatSec);
        headers["X-Device-JTI"] = jti;
        headers["X-Body-SHA256"] = bodySha256B64u;
        headers["X-Device-Signature"] = signatureB64u;

        logX402("[device-sign:v2] path=", path,
            " userId=", userId,
            " iat=", iatSec,
            " jtiPrefix=", jti.slice(0, 10),
            " bodyLen=", bodyText.length,
            " bodyShaPrefix=", bodySha256B64u.slice(0, 12),
            " sigPrefix=", signatureB64u.slice(0, 16));
    } else {
        bodyText = JSON.stringify(requestBody);
    }

    logX402("------>>> url:", url);
    const response = await fetch(url, {
        method: "POST",
        headers,
        body: bodyText,
    });

    if (!response.ok) {
        const errorText = await response.text();
        logX402("[x402WorkerFetch] failed path=", path, " status=", response.status, " body=", errorText);
        let detail = errorText;
        try {
            const parsed = JSON.parse(errorText);
            const code = parsed?.code || parsed?.error?.code || parsed?.error;
            const message = parsed?.message || parsed?.error?.message || parsed?.detail;
            detail = [code, message].filter(Boolean).join(" | ") || errorText;
        } catch {
            // keep raw text
        }
        throw new Error(`x402WorkerFetch failed (${response.status}): ${detail}`);
    }

    return await response.json();
}


export async function x402WorkerGet(path: string, params?: Record<string, string>): Promise<any> {
    const chainID = await getChainId()
    let url = X402_FACILITATORS[chainID].endpoint + path

    if (params) {
        const searchParams = new URLSearchParams(params);
        url += "?" + searchParams.toString();
    }

    logX402("------>>> GET url:", url)
    const response = await fetch(url, {
        method: "GET",
        headers: {
            "Content-Type": "application/json",
        },
    });

    if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`x402worker GET failed: ${response.status} - ${errorData}`);
    }

    return await response.json();
}

/**
 * POC: 使用 USDC 支付 Gas 部署广告合约
 */
export async function deployAdVaultPOC(adId: string): Promise<string> {
    const chainId = await getChainId();
    const facilitator = X402_FACILITATORS[chainId];
    const platformAddress = facilitator.settlementContract as `0x${string}`;

    const initialBudgetAtomic = 10000n; // 0.01 USDC 测试充值，用于验证 Batch 扣费和 Gas 扣费
    const { deployHash, predictedAddress } = await AdDeployer.deployAdVault(
        chainId,
        platformAddress,
        adId,
    );

    if (initialBudgetAtomic > 0n) {
        const amountStr = (Number(initialBudgetAtomic) / 1_000_000).toString();
        await transferUSDCByX402(chainId, predictedAddress, amountStr);
    }

    return deployHash;
}
