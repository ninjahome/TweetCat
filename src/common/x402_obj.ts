
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

export interface StoredX402Session {
    session: X402SessionKey
    authorization: X402SessionAuthorization
    createdAt: number
}


// x402_obj.ts
export interface X402SessionKey {
    address: string
    privateKey: string
    chainId: number
    expiresAt: number
    maxTotalAmount: string
    spentAmount: string
}

export const X402_SCOPE = "x402:eip3009" as const

export interface X402SessionAuthorizationPayload {
    owner: string              // 主钱包地址
    sessionKey: string         // session address
    scope: "x402:eip3009"
    chainId: number
    maxAmount: string
    validAfter: number         // seconds
    validBefore: number        // seconds
}

export interface X402SessionAuthorization {
    payload: X402SessionAuthorizationPayload
    signature: string          // owner 对 payload 的 EIP-712 签名
}


export interface StoredX402Session {
    session: X402SessionKey
    authorization: X402SessionAuthorization
    createdAt: number
}
export const X402_SESSION_STORE_KEY = "x402:session:v1"

export const X402_SESSION_AUTH_DOMAIN = (chainId: number) => ({
    name: "TweetCat x402 Session",
    version: "1",
    chainId,
})

export const X402_SESSION_AUTH_TYPES = {
    X402Session: [
        { name: "owner", type: "address" },
        { name: "sessionKey", type: "address" },
        { name: "scope", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "maxAmount", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
    ],
}


interface CdpEip3009 {
    from: string
    to: string
    value: string
    validAfter: number
    validBefore: number
    nonce: string
    signature: string
}
