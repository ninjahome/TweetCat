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
import { ChainIDBaseMain, ChainIDBaseSepolia, initCDP, isCdpAuthError, toCdpSessionError, walletInfo, X402_FACILITATORS } from "../common/x402_obj";
import { getChainId } from "./wallet_setting";
import {
    EndUserEvmAccount,
    EndUserEvmSmartAccount,
    EvmAddress,
    exportEvmAccount,
    getAccessToken,
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
import { getDevicePublicKeySpkiB64, signDeviceRequestV2 } from "../common/device_key";
import { fetchWithTimeout, sleep } from "../common/utils";

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
    try {
        await initCDP();
        if (!await isSignedIn()) throw new Error("Not signed in");
        const user = await getCurrentUser();
        const eoa = user.evmAccountObjects?.[0];
        if (!eoa) {
            throw new Error("EOA account not found");
        }
        return eoa;
    } catch (e: any) {
        if (e instanceof TypeError && e.message?.includes("Failed to fetch")) {
            throw new Error("CDP service temporarily unavailable. Please retry later.");
        }
        throw toCdpSessionError(e);
    }
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
        if (isCdpAuthError(e)) {
            return null;
        }
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
    const failedWallet = { address: "", ethVal: "", usdcVal: "", hasCreated: false, chainId: -1, xId: null, userId: null };
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
        const userId = user?.userId || null;
        const username = user?.authenticationMethods?.x?.username
        console.log("----->>> query wallet infor for:", chainId, " wallet:", eoa, " x info:", user?.authenticationMethods?.x)

        return {
            address: eoa.address,
            ethVal: eth,
            usdcVal: usdc,
            hasCreated: true,
            chainId,
            xId,
            userId,
            username
        };
    } catch (error) {
        if (!isCdpAuthError(error)) {
            console.warn('Failed to query CDP wallet info:', error);
        }
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

export async function postToX402Srv(path: string, body: any, chainIdOverride?: number) {
    const chainId = chainIdOverride ?? await getChainId();
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

import { API_PATH_VALIDATE_TOKEN, signedOperationPaths } from "../common/api_paths";

function extractWorkerErrorDetail(errorText: string): string {
    let detail = errorText;
    try {
        const parsed = JSON.parse(errorText);
        const code = parsed?.code || parsed?.error?.code || parsed?.error;
        const message = parsed?.message || parsed?.error?.message || parsed?.detail;
        if (code || message) detail = `${code}: ${message}`;
    } catch {
    }
    return detail;
}

function shouldRefreshDeviceKey(path: string, status: number, detail: string): boolean {
    if (!signedOperationPaths.includes(path)) return false;
    if (status !== 400 && status !== 401) return false;
    return detail.includes("INVALID_SIGNATURE")
        || detail.includes("DEVICE_KEY_NOT_FOUND")
        || detail.includes("USER_NOT_FOUND");
}

async function syncDeviceKeyWithWorker(chainID: number): Promise<boolean> {
    try {
        await initCDP();
        if (!await isSignedIn()) {
            logX402("[device-sign:resync] skipped: user not signed in");
            return false;
        }

        const accessToken = await getAccessToken();
        if (!accessToken) {
            logX402("[device-sign:resync] skipped: missing access token");
            return false;
        }

        const devicePubkey = await getDevicePublicKeySpkiB64();
        const url = X402_FACILITATORS[chainID].endpoint + API_PATH_VALIDATE_TOKEN;
        const response = await fetchWithTimeout(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                accessToken,
                device_pubkey: devicePubkey,
            }),
            referrerPolicy: "no-referrer",
            credentials: "omit"
        }, 12_000);

        if (!response.ok) {
            const errorText = await response.text();
            logX402("[device-sign:resync] failed status=", response.status, " body=", errorText);
            return false;
        }

        const result = await response.json().catch(() => ({}));
        logX402("[device-sign:resync] success chain=", chainID, " isNewUser=", result?.isNewUser);
        return true;
    } catch (err) {
        console.error("[device-sign:resync] unexpected error", err);
        return false;
    }
}

export async function x402WorkerFetch(path: string, body: any, userIdOverride?: string | null, chainIdOverride?: number, didRefreshDeviceKey: boolean = false): Promise<any> {
    const chainID = chainIdOverride ?? await getChainId();
    const url = X402_FACILITATORS[chainID].endpoint + path;
    let requestBody = body;
    let bodyText = "";

    const headers: Record<string, string> = {
        "Content-Type": "application/json",
    };

    if (signedOperationPaths.includes(path)) {
        const userId = userIdOverride || await queryCdpUserID();
        if (!userId) throw new Error("User not signed in (missing userId)");

        console.log(`[x402Fetch] Signing request for path: ${path}, userId: ${userId}`);

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
    try {
        console.log(`[x402Fetch] Request Headers:`, JSON.stringify(headers));
        const MAX_RETRIES = 2;
        const TIMEOUT_MS = 12_000;
        let lastErr: any = null;
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                const response = await fetchWithTimeout(url, {
                    method: "POST",
                    headers,
                    body: bodyText,
                    referrerPolicy: "no-referrer",
                    credentials: "omit"
                }, TIMEOUT_MS);
                if (!response.ok) {
                    const errorText = await response.text();
                    logX402("[x402WorkerFetch] failed path=", path, " status=", response.status, " body=", errorText);
                    const detail = extractWorkerErrorDetail(errorText);

                    if (!didRefreshDeviceKey && shouldRefreshDeviceKey(path, response.status, detail)) {
                        logX402("[x402WorkerFetch] attempting device key resync for path=", path, " status=", response.status);
                        const refreshed = await syncDeviceKeyWithWorker(chainID);
                        if (refreshed) {
                            return await x402WorkerFetch(path, body, userIdOverride, chainID, true);
                        }
                    }

                    throw new Error(`x402WorkerFetch failed (${response.status}): ${detail}`);
                }
                return await response.json();
            } catch (err: any) {
                lastErr = err;
                const isAbort = err?.name === "AbortError";
                const isTypeError = err instanceof TypeError && err.message?.includes("Failed to fetch");
                if (attempt < MAX_RETRIES && (isAbort || isTypeError)) {
                    await sleep(500 * (attempt + 1));
                    continue;
                }
                throw err;
            }
        }
        throw lastErr;
    } catch (e: any) {
        console.error(`[x402Fetch] CRITICAL ERROR for path ${path}:`, e);
        if (e instanceof TypeError && e.message === "Failed to fetch") {
            console.error(`[x402Fetch] This might be a CORS error, network block, or invalid header. Checked manifest?`);
        }
        throw e;
    }
}


export async function x402WorkerGet(path: string, params?: Record<string, string>, chainIdOverride?: number): Promise<any> {
    const chainID = chainIdOverride ?? await getChainId()
    let url = X402_FACILITATORS[chainID].endpoint + path

    if (params) {
        const searchParams = new URLSearchParams(params);
        url += "?" + searchParams.toString();
    }

    logX402("------>>> GET url:", url)
    const MAX_RETRIES = 2;
    const TIMEOUT_MS = 10_000;
    let lastErr: any = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            const response = await fetchWithTimeout(url, {
                method: "GET",
                cache: "no-store",
                headers: {
                    "Content-Type": "application/json",
                    "Cache-Control": "no-cache",
                    "Pragma": "no-cache",
                },
            }, TIMEOUT_MS);
            if (!response.ok) {
                const errorData = await response.text();
                throw new Error(`x402worker GET failed: ${response.status} - ${errorData}`);
            }
            return await response.json();
        } catch (err: any) {
            lastErr = err;
            const isAbort = err?.name === "AbortError";
            const isTypeError = err instanceof TypeError && err.message?.includes("Failed to fetch");
            if (attempt < MAX_RETRIES && (isAbort || isTypeError)) {
                await sleep(400 * (attempt + 1));
                continue;
            }
            throw err;
        }
    }
    throw lastErr;
}
