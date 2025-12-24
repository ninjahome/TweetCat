import {base, baseSepolia} from 'viem/chains'
import {
    createPublicClient,
    Address,
    parseEther,
    parseUnits,
    http,
    formatEther,
    custom,
    formatUnits,
    isAddress,
    getAddress,
    encodeFunctionData,
    createWalletClient,
    WalletClient,
    Account,
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
    createCDPEmbeddedWallet,
    EndUserEvmAccount,
    EndUserEvmSmartAccount,
    EvmAddress,
    getCurrentUser,
    isSignedIn,
    sendEvmTransaction,
    sendUserOperation
} from "@coinbase/cdp-core";
import {ClientEvmSigner} from "@x402/evm";
import {x402Client} from "@x402/core/client";
import {registerExactEvmScheme} from "@x402/evm/exact/client";
import {wrapFetchWithPayment} from "@x402/fetch";

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
async function getEOA(): Promise<EndUserEvmAccount> {
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
    if (!address || address === '未知') {
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
            hasCreated: true
        };
    } catch (error) {
        console.error('Failed to query CDP wallet info:', error);
        return {address: "", ethVal: "", usdcVal: "", hasCreated: false};
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




function getEmbeddedWallet() {
    return createCDPEmbeddedWallet({
        chains: [base, baseSepolia],
        transports: {
            [base.id]: http(),
            [baseSepolia.id]: http(),
        },
        announceProvider: false,
    });
}


function toClientEvmSigner(walletClient: WalletClient): ClientEvmSigner {
    if (!walletClient.account) {
        throw new Error("Wallet client must have an account");
    }

    return {
        address: walletClient.account.address,
        signTypedData: async (message) => {
            return await walletClient.signTypedData({
                account: walletClient.account as Account,
                domain: message.domain,
                types: message.types,
                primaryType: message.primaryType,
                message: message.message,
            });
        },
    };
}

export async function initX402Client(): Promise<typeof fetch> {

    // 2. 获取当前 chainId
    const chainId = await getChainId();
    console.log(`[x402] Initializing for chainId: ${chainId}`);

    // 3. 根据 chainId 选择对应的链配置
    const chain = getChain(chainId);
    console.log(`[x402] Using chain: ${chain.name}`);

    // 4. 获取 EOA 账户地址
    const eoa = await getEOA();
    const address = eoa.address as `0x${string}`;
    console.log(`[x402] Using address: ${address}`);

    const wallet = getEmbeddedWallet();

    // 6. 创建 viem WalletClient
    const walletClient = createWalletClient({
        account: {address, type: "json-rpc"},
        chain,
        transport: custom(wallet.provider),
    });

    // 7. 转换为 x402 需要的 ClientEvmSigner 类型
    const signer = toClientEvmSigner(walletClient);

    // 8. 创建 x402Client 并注册 EVM scheme
    const client = new x402Client();
    registerExactEvmScheme(client, {
        signer,
        networks: [`eip155:${chain.id}`],
    });

    console.log(`[x402] Client initialized successfully for ${chain.name}`);

    // 9. 返回包装后的 fetch 函数
    return wrapFetchWithPayment(fetch, client);
}

