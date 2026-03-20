import { initialize, signOut } from "@coinbase/cdp-core";

export const ChainIDBaseSepolia = 84532 as const
export const ChainIDBaseMain = 8453 as const

export const BASE_MAINNET_DEFAULT_RPC = "https://basescan.org" as const
export const BASE_SEPOLIA_DEFAULT_RPC = "https://sepolia.basescan.org" as const
export const BASE_MAINNET_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const
export const BASE_SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const

export const ChainNameBaseSepolia = "base-sepolia" as const
export const ChainNameBaseMain = "base-mainnet" as const
export type ChainNetwork = typeof ChainNameBaseSepolia | typeof ChainNameBaseMain

export const x402_connection_name = "wallet-offscreen"

export interface X402FacilitatorConfig {
    chainId: number
    network: ChainNetwork
    usdcAddress: string
    settlementContract: string
    endpoint: string
    browser: string
    paymasterRpc: string
    adFactory: string
}

export const X402_FACILITATORS: Record<number, X402FacilitatorConfig> = {
    // Base Sepolia
    [ChainIDBaseSepolia]: {
        chainId: ChainIDBaseSepolia,
        network: ChainNameBaseSepolia,
        usdcAddress: BASE_SEPOLIA_USDC,
        settlementContract: "0x1BD5fF7e17ec7950cAA06BF2DeB0038C54d31Fc2",
        endpoint: "https://tweetcattips-dev.ribencong.workers.dev",
        browser: BASE_SEPOLIA_DEFAULT_RPC,
        paymasterRpc: "https://api.developer.coinbase.com/rpc/v1/base-sepolia/qhDlFJwedElH91oevIr2d01Gq1AC15TJ",
        adFactory: "0xB6cCD39C11a32E8efAeD28D2Fc1a78d65ef5Cb08",
    },

    // Base Mainnet
    [ChainIDBaseMain]: {
        chainId: ChainIDBaseMain,
        network: ChainNameBaseMain,
        usdcAddress: BASE_MAINNET_USDC,
        settlementContract: "0x1BD5fF7e17ec7950cAA06BF2DeB0038C54d31Fc2",
        endpoint: "https://tweetcattips.ribencong.workers.dev",
        browser: BASE_MAINNET_DEFAULT_RPC,
        paymasterRpc: "https://api.developer.coinbase.com/rpc/v1/base/qhDlFJwedElH91oevIr2d01Gq1AC15TJ",
        adFactory: "0x0000000000000000000000000000000000000000",
    },
}

export interface x402TipPayload {
    tweetId: string;
    authorId: string;
    usdcVal: number
    payTo?: string;
}

export async function doSignOut() {
    try {
        await initCDP();
        await signOut();
    } catch (error) {
        if (!isCdpAuthError(error)) {
            throw error;
        }
    } finally {
        resetCDPInitState();
    }
}

const PROJECT_ID = "602a8505-5645-45e5-81aa-a0a642ed9a0d";

let cdpInitPromise: Promise<void> | null = null;

export function resetCDPInitState(): void {
    cdpInitPromise = null;
}

export function isCdpAuthError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error ?? "");
    const normalized = message.toLowerCase();
    return normalized.includes("401")
        || normalized.includes("unauthorized")
        || normalized.includes("auth/refresh")
        || normalized.includes("auth/logout")
        || normalized.includes("not signed in")
        || normalized.includes("please sign in first")
        || normalized.includes("user not signed in");
}

export function toCdpSessionError(error: unknown, fallback = "Please sign in first"): Error {
    if (isCdpAuthError(error)) {
        return new Error(fallback);
    }
    if (error instanceof Error) return error;
    return new Error(String(error ?? fallback));
}

export async function initCDP() {
    if (cdpInitPromise) return cdpInitPromise;
    cdpInitPromise = initialize({
        projectId: PROJECT_ID,
        ethereum: {
            createOnLogin: "smart",
        },
    });
    cdpInitPromise.catch(() => {
        resetCDPInitState();
    });
    return cdpInitPromise;
}

export interface walletInfo {
    hasCreated: boolean;
    address: string;
    ethVal: string;
    usdcVal: string;
    chainId: number;
    xId: string | null;
    userId: string | null;
    username?: string;
}
