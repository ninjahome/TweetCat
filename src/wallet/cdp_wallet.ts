import {base, baseSepolia} from 'viem/chains'
import {
    createPublicClient,
    Address,
    parseEther,
    parseUnits,
    http,
    formatEther,
    formatUnits,
    isAddress,
    getAddress,
    encodeFunctionData,
    bytesToHex, padHex, toHex, isHex,
} from 'viem'
import {
    ChainIDBaseMain,
    ChainIDBaseSepolia,
    initCDP,
    walletInfo,
    X402_FACILITATORS
} from "../common/x402_obj";
import {getChainId} from "./wallet_setting";
import {
    EndUserEvmAccount,
    EndUserEvmSmartAccount,
    EvmAddress, exportEvmAccount,
    getCurrentUser,
    isSignedIn,
    sendEvmTransaction,
    sendUserOperation, signEvmTypedData
} from "@coinbase/cdp-core";
import {ClientEvmSigner} from "@x402/evm";
import {x402Client} from "@x402/core/client";
import {registerExactEvmScheme} from "@x402/evm/exact/client";
import {wrapFetchWithPayment} from "@x402/fetch";
import {privateKeyToAccount} from "viem/accounts";

const ERC20_BALANCE_ABI = [
    {
        name: 'balanceOf',
        type: 'function',
        stateMutability: 'view',
        inputs: [{name: 'account', type: 'address'}],
        outputs: [{type: 'uint256'}],
    },
] as const

const USDC_ABI = [{
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{name: "to", type: "address"}, {name: "amount", type: "uint256"}],
    outputs: [{type: "bool"}],
}] as const;

// ============ 链配置工具函数 ============
function getChain(chainId: number) {
    if (chainId === ChainIDBaseMain) return base;
    if (chainId === ChainIDBaseSepolia) return baseSepolia;
    throw new Error(`Unsupported chain: ${chainId}`);
}

export function getPublicClient(chainId: number) {
    return createPublicClient({chain: getChain(chainId), transport: http()});
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

async function getSmart(): Promise<EndUserEvmSmartAccount> {
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

export async function queryCdpWalletInfo(): Promise<walletInfo> {
    try {
        const eoa = await getEOA();
        const chainId = await getChainId();
        const {eth, usdc} = await queryWalletBalance(eoa.address, chainId);

        return {
            address: eoa.address,
            ethVal: eth,
            usdcVal: usdc,
            hasCreated: true,
            chainId
        };
    } catch (error) {
        console.error('Failed to query CDP wallet info:', error);
        return {address: "", ethVal: "", usdcVal: "", hasCreated: false,chainId:-1};
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
    const domain = {...args.domain};

    if (domain.chainId) domain.chainId = Number(domain.chainId);

    const types: Record<string, readonly Eip712Field[]> = {...(args.types || {})};
    if (!types.EIP712Domain) {
        types.EIP712Domain = buildEip712DomainTypes(domain);
    }

    const message = {...args.message};
    const fields = (types?.[args.primaryType] ?? []) as readonly Eip712Field[];
    const typeByName = new Map(fields.map((f) => [f.name, f.type] as const));

    for (const [k, v] of Object.entries(message)) {
        message[k] = normalizeEip712Value(v, typeByName.get(k));
    }

    return {...args, domain, types, message};
}

function normalizeEip712Value(value: any, typeHint?: string): any {
    if (typeof value === 'bigint') {
        return value.toString();
    }

    if (value instanceof Uint8Array) {
        const hex = bytesToHex(value);
        return typeHint === 'bytes32' ? padHex(hex, {size: 32}) : hex;
    }

    if (typeof value === 'number') {
        if (typeHint === 'bytes32') {
            return padHex(toHex(BigInt(value)), {size: 32});
        }
        return value;
    }

    if (typeof value === 'string') {
        if (typeHint === 'bytes32') {
            if (isHex(value)) {
                return padHex(value, {size: 32});
            }
            try {
                return padHex(toHex(BigInt(value)), {size: 32});
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

    if (domain?.name != null) fields.push({name: "name", type: "string"});
    if (domain?.version != null) fields.push({name: "version", type: "string"});
    if (domain?.chainId != null) fields.push({name: "chainId", type: "uint256"});
    if (domain?.verifyingContract != null) fields.push({name: "verifyingContract", type: "address"});
    if (domain?.salt != null) fields.push({name: "salt", type: "bytes32"});

    return fields.length ? fields : [{name: "chainId", type: "uint256"}];
}


export async function initX402ClientWithPrivateKey(): Promise<typeof fetch> {
    // 1. 获取 EOA
    const eoa = await getEOA();

    // 2. 导出私钥
    const exportResult = await exportEvmAccount({
        // 注意：根据 CDP Core SDK，参数名可能是 evmAccount 或 address，请以你当前版本为准
        evmAccount: eoa.address as `0x${string}`
    });

    // 3. 核心修复：确保私钥格式正确
    let rawKey = exportResult.privateKey;
    if (!rawKey.startsWith('0x')) {
        rawKey = `0x${rawKey}`;
    }

    const chainId = await getChainId();

    // 4. 创建账户
    const account = privateKeyToAccount(rawKey as `0x${string}`);
    // 5. 初始化 x402 客户端
    const client = new x402Client();
    registerExactEvmScheme(client, {
        signer: account,
        networks: [`eip155:${chainId}`],
    });

    return wrapFetchWithPayment(fetch, client);
}