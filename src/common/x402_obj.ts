export const EIP3009_TYPES = {
    TransferWithAuthorization: [
        {name: "from", type: "address"},
        {name: "to", type: "address"},
        {name: "value", type: "uint256"},
        {name: "validAfter", type: "uint256"},
        {name: "validBefore", type: "uint256"},
        {name: "nonce", type: "bytes32"},
    ],
};

// EIP-3009 / x402 专用签名参数
export interface Eip3009AuthorizationParams {
    domain: {
        name: string;              // e.g. "USD Coin"
        version: string;           // e.g. "2"
        chainId: number;           // Base / Base Sepolia
        verifyingContract: string; // USDC 合约地址
    };
    message: {
        from: string;        // payer address
        to: string;          // payTo address
        value: string;       // uint256, 最小单位（string）
        validAfter: number;  // uint256 (seconds)
        validBefore: number; // uint256 (seconds)
        nonce: string;       // bytes32 / uint256 string
    };
    password: string;
}

// x402_obj.ts
export interface CdpEip3009 {
    from: string
    to: string
    value: string
    validAfter: number
    validBefore: number
    nonce: string
    signature: string
}


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
        settlementContract:"0x06856d7a17b0ac072a845fbe95812e94ef8c2411",
        endpoint: "https://facilitator.sepolia.x402.org",
    },

    // Base Mainnet
    [ChainIDBaseMain]: {
        chainId: ChainIDBaseMain,
        network: ChainNameBaseMain,
        usdcAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        settlementContract:"0x06856d7a17b0ac072a845fbe95812e94ef8c2411",
        endpoint: "https://facilitator.x402.org",
    },
}

export interface X402SubmitInput {
    facilitator: X402FacilitatorConfig
    transfer: CdpEip3009
}

export type X402SubmitResult =
    | {
    ok: true
    txHash: string
    status: "submitted" | "confirmed"
}
    | {
    ok: false
    error:
        | "FACILITATOR_REJECTED"
        | "INVALID_AUTHORIZATION"
        | "INSUFFICIENT_FUNDS"
        | "SESSION_EXPIRED"
        | "NETWORK_ERROR"
        | "UNKNOWN_ERROR"
    message?: string
}

export const X402TaskKey = "x402_popup_task"
export interface X402PopupTask{
    type:string;
    payload:any;
    createdAt:number;
}

export interface x402TipPayload{
    tweetId:string;
    authorId:string;
    walletAddr?:string;
}