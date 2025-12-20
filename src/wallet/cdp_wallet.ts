import {base, baseSepolia} from 'viem/chains'
import {createPublicClient, http, formatEther} from 'viem'
import {
    ChainIDBaseMain,
    ChainIDBaseSepolia,
    ChainNameBaseMain, tryGetSignedInUser,
    walletInfo,
    X402_FACILITATORS
} from "../common/x402_obj";
import {loadWalletSettings} from "./wallet_setting";
import {BASE_MAINNET_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID} from "../common/consts";

const ERC20_BALANCE_ABI = [
    {
        constant: true,
        inputs: [{name: '_owner', type: 'address'}],
        name: 'balanceOf',
        outputs: [{name: 'balance', type: 'uint256'}],
        type: 'function',
    },
] as const


const NETWORK_RUNTIME_CONFIG: Record<number, {
    chain: any
    rpcUrl: string
}> = {
    [ChainIDBaseSepolia]: {
        chain: baseSepolia,
        rpcUrl: 'https://sepolia.base.org',
    },
    [ChainIDBaseMain]: {
        chain: base,
        rpcUrl: 'https://mainnet.base.org',
    },
}

function getPublicClient(networkId: number) {
    const cfg = NETWORK_RUNTIME_CONFIG[networkId]
    if (!cfg) {
        throw new Error(`Unsupported networkId: ${networkId}`)
    }

    return createPublicClient({
        chain: cfg.chain,
        transport: http(cfg.rpcUrl),
    })
}


export interface WalletBalance {
    eth: string       // 已格式化
    usdc: string      // 已格式化
}

export async function queryWalletBalance(
    address: string,
    networkId: number,
): Promise<WalletBalance> {

    if (!address || address === '未知') {
        throw new Error('Invalid address')
    }

    const facilitator = X402_FACILITATORS[networkId]
    if (!facilitator) {
        throw new Error(`No facilitator config for networkId=${networkId}`)
    }

    const client = getPublicClient(networkId)

    // ETH
    const ethRaw = await client.getBalance({
        address: address as `0x${string}`,
    })

    // USDC
    const usdcRaw = await client.readContract({
        address: facilitator.usdcAddress as `0x${string}`,
        abi: ERC20_BALANCE_ABI,
        functionName: 'balanceOf',
        args: [address as `0x${string}`],
        authorizationList: undefined, // viem TS 兼容
    }) as bigint

    return {
        eth: Number(formatEther(ethRaw)).toFixed(6),
        usdc: (Number(usdcRaw) / 1_000_000).toFixed(2),
    }
}

export async function queryCdpWalletInfo(): Promise<walletInfo> {
    const user = await tryGetSignedInUser();
    if (!user) {
        return {address: "", ethVal: "", usdcVal: "", hasCreated: false}
    }

    const address = user.evmAccounts[0];
    if (!address) {
        return {address: "", ethVal: "", usdcVal: "", hasCreated: false}
    }

    const settings = await loadWalletSettings();
    const chainId =
        settings.network === ChainNameBaseMain
            ? BASE_MAINNET_CHAIN_ID
            : BASE_SEPOLIA_CHAIN_ID;

    const {eth, usdc} = await queryWalletBalance(address, chainId)

    return {address: address, ethVal: eth, usdcVal: usdc, hasCreated: true}
}