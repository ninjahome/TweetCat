import {base, baseSepolia} from 'viem/chains'
import {
    createPublicClient,
    createWalletClient,
    custom,
    formatEther,
    http,
} from 'viem'
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

const ERC20_TRANSFER_ABI = [
    {
        constant: false,
        inputs: [
            {name: '_to', type: 'address'},
            {name: '_value', type: 'uint256'},
        ],
        name: 'transfer',
        outputs: [{name: 'success', type: 'bool'}],
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

export async function getWalletClient(networkId: number) {
    const cfg = NETWORK_RUNTIME_CONFIG[networkId]
    if (!cfg) {
        throw new Error(`Unsupported networkId: ${networkId}`)
    }

    const user = await tryGetSignedInUser()
    if (!user) {
        throw new Error('Please sign in to CDP wallet first')
    }

    const ethereum = (user as any)?.ethereum
    if (!ethereum) {
        throw new Error('CDP wallet provider is unavailable')
    }

    const walletClient = createWalletClient({
        account: user.evmAccounts?.[0] as `0x${string}` | undefined,
        chain: cfg.chain,
        transport: custom(ethereum),
    })

    try {
        const currentChainId = await walletClient.getChainId()
        if (currentChainId !== networkId) {
            await walletClient.switchChain({id: networkId}).catch(() => undefined)
        }
    } catch {
        // ignore switching errors; downstream calls will surface if chain mismatched
    }

    return walletClient
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

function normalizeWalletError(error: unknown): Error {
    if (error instanceof Error) return error
    return new Error(String(error))
}

export async function sendEth(
    to: string,
    amount: bigint,
    gas: bigint | undefined,
    networkId: number,
): Promise<`0x${string}`> {
    try {
        const client = await getWalletClient(networkId)
        const [account] = await client.getAddresses()
        if (!account) {
            throw new Error('CDP wallet address not found')
        }

        return await client.sendTransaction({
            account,
            to: to as `0x${string}`,
            value: amount,
            gas,
        })
    } catch (error) {
        throw normalizeWalletError(error)
    }
}

export async function sendUsdc(
    to: string,
    amount: bigint,
    gas: bigint | undefined,
    networkId: number,
): Promise<`0x${string}`> {
    const facilitator = X402_FACILITATORS[networkId]
    if (!facilitator) {
        throw new Error(`No facilitator config for networkId=${networkId}`)
    }

    try {
        const client = await getWalletClient(networkId)
        const [account] = await client.getAddresses()
        if (!account) {
            throw new Error('CDP wallet address not found')
        }

        return await client.writeContract({
            account,
            abi: ERC20_TRANSFER_ABI,
            address: facilitator.usdcAddress as `0x${string}`,
            functionName: 'transfer',
            args: [to as `0x${string}`, amount],
            gas,
        })
    } catch (error) {
        throw normalizeWalletError(error)
    }
}

export async function signMessage(message: string, networkId: number): Promise<`0x${string}`> {
    try {
        const client = await getWalletClient(networkId)
        const [account] = await client.getAddresses()
        if (!account) {
            throw new Error('CDP wallet address not found')
        }

        return await client.signMessage({account, message})
    } catch (error) {
        throw normalizeWalletError(error)
    }
}

export async function signTypedData(params: any, networkId: number): Promise<`0x${string}`> {
    try {
        const client = await getWalletClient(networkId)
        const [account] = await client.getAddresses()
        if (!account) {
            throw new Error('CDP wallet address not found')
        }

        return await client.signTypedData({...params, account})
    } catch (error) {
        throw normalizeWalletError(error)
    }
}
