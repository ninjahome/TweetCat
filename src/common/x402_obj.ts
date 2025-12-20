import {getCurrentUser, initialize, signOut} from "@coinbase/cdp-core";
export const ChainIDBaseSepolia = 84532 as const
export const ChainIDBaseMain = 8453 as const

export const ChainNameBaseSepolia = "base-sepolia" as const
export const ChainNameBaseMain = "base-mainnet" as const
export type ChainNetwork = typeof ChainNameBaseSepolia | typeof ChainNameBaseMain

export interface X402FacilitatorConfig {
    chainId: number
    network: ChainNetwork
    usdcAddress: string
    settlementContract: string
    endpoint: string
}

export const X402_FACILITATORS: Record<number, X402FacilitatorConfig> = {
    // Base Sepolia
    [ChainIDBaseSepolia]: {
        chainId: ChainIDBaseSepolia,
        network: ChainNameBaseSepolia,
        usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        settlementContract: "0x06856d7a17b0ac072a845fbe95812e94ef8c2411",
        endpoint: "https://facilitator.sepolia.x402.org",
    },

    // Base Mainnet
    [ChainIDBaseMain]: {
        chainId: ChainIDBaseMain,
        network: ChainNameBaseMain,
        usdcAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        settlementContract: "0x06856d7a17b0ac072a845fbe95812e94ef8c2411",
        endpoint: "https://facilitator.x402.org",
    },
}
export interface x402TipPayload {
    tweetId: string;
    authorId: string;
    usdcVal: number
    payTo?: string;
}

export const MAX_TIP_AMOUNT = 1000;

export async function tryGetSignedInUser() {
    await initCDP();
    try {
        return await getCurrentUser();
    } catch {
        return null;
    }
}

export async function doSignOut() {
    await initCDP();
    await signOut();
}

const PROJECT_ID = "602a8505-5645-45e5-81aa-a0a642ed9a0d";
export async function initCDP() {
    await initialize({
        projectId: PROJECT_ID,
        ethereum: {
            createOnLogin: "smart",
        },
    });
}


export interface walletInfo {
    hasCreated: boolean;
    address: string;
    ethVal: string;
    usdcVal: string;
}

