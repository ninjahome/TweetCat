import {base, baseSepolia} from 'viem/chains'
import {
    createPublicClient,
    Address,
    parseEther,
    parseUnits,
    http,
    formatEther,
    createWalletClient,
    formatUnits, isAddress, getAddress, encodeFunctionData,
} from 'viem'
import {
    ChainIDBaseMain,
    ChainIDBaseSepolia, initCDP,
    walletInfo,
    X402_FACILITATORS
} from "../common/x402_obj";
import {getChainId} from "./wallet_setting";
import {EvmAddress, getCurrentUser, isSignedIn, toViemAccount,sendUserOperation} from "@coinbase/cdp-core";

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
    inputs: [{name: "to", type: "address"}, {name: "amount", type: "uint256"},],
    outputs: [{type: "bool"}],
},] as const;


export async function getWalletAddress(): Promise<string | undefined> {
    return _address()
}

 async function _address(): Promise<EvmAddress | undefined> {
    await initCDP()
    try {
        if (!await isSignedIn()) return undefined;

        const user = await getCurrentUser();

        return user.evmSmartAccounts?.[0] ?? user.evmAccounts?.[0];
    } catch (error) {
        console.error('Failed to get wallet address:', error);
        return undefined;
    }
}

function getChain(chainId: number) {
    if (chainId === ChainIDBaseMain) return base;
    if (chainId === ChainIDBaseSepolia) return baseSepolia;
    throw new Error("Unsupported chain");
}

async function getWalletClient(chainId: number) {
    const addr = await  _address()
    const account = toViemAccount(addr);
    const chain = getChain(chainId);

    return createWalletClient({
        account,
        chain,
        transport: http(), // Base 有官方免费 RPC，Smart Account 会处理签名
    });
}

export function getPublicClient(chainId: number) {
    return createPublicClient({chain: getChain(chainId), transport: http()});
}

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
        authorizationList: undefined, // viem v2 类型要求
    }) as bigint;

    return {
        eth: Number(formatEther(ethRaw)).toFixed(6),
        usdc: formatUnits(usdcRaw, 6),
    };
}

export async function queryCdpWalletInfo(): Promise<walletInfo> {
    try {
        const address = await getWalletAddress();
        if (!address) {
            return {address: "", ethVal: "", usdcVal: "", hasCreated: false};
        }

        const chainId = await getChainId();
        const {eth, usdc} = await queryWalletBalance(address, chainId);

        return {
            address: address,
            ethVal: eth,
            usdcVal: usdc,
            hasCreated: true
        };
    } catch (error) {
        console.error('Failed to query CDP wallet info:', error);
        return {address: "", ethVal: "", usdcVal: "", hasCreated: false};
    }
}

export async function transferUSDC(
    chainId: number,
    toAddress: string,
    amountUsdc: string
): Promise<`0x${string}`> {
    if (!isAddress(toAddress)) {
        throw new Error(`Invalid recipient address: ${toAddress}`);
    }
    const to = getAddress(toAddress); // 转换为标准的 Address (0x...)

    const smartAccount = await _address();
    if (!smartAccount) {
        throw new Error("No Smart Account found");
    }

    const usdcAddress = X402_FACILITATORS[chainId].usdcAddress as Address;

    // 1️⃣ encode ERC20 transfer calldata
    const data = encodeFunctionData({
        abi: USDC_ABI,
        functionName: "transfer",
        args: [to, parseUnits(amountUsdc, 6)],
    });

    // 2️⃣ send UserOperation
    const result = await sendUserOperation({
        evmSmartAccount: smartAccount,
        network: chainId === 8453 ? "base" : "base-sepolia",
        calls: [
            {
                to: usdcAddress,
                value: 0n,
                data,
            },
        ],
        // 如果你未来启用 spend-permissions / paymaster
        // useCdpPaymaster: true,
    });

    return result.userOperationHash as `0x${string}`;
}


export async function transferETH(
    chainId: number,
    toAddress: string,
    amountEth: string
): Promise<`0x${string}`> {

    if (!isAddress(toAddress)) {
        throw new Error(`Invalid recipient address: ${toAddress}`);
    }
    const to = getAddress(toAddress);

    const smartAccount = await _address()
    if (!smartAccount) {
        throw new Error("No Smart Account found");
    }

    // 4. 发送 UserOperation（ETH 转账）
    const result = await sendUserOperation({
        evmSmartAccount: smartAccount,
        network:chainId === 8453 ? "base" : "base-sepolia" ,
        calls: [
            {
                to,
                value: parseEther(amountEth),
                data: "0x",   // ETH 转账，calldata 为空
            },
        ],
        // 👉 如果你要 gas 赞助（facilitator）
        // useCdpPaymaster: true,
    });

    return result.userOperationHash as `0x${string}`;
}





