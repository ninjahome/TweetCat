import browser from "webextension-polyfill";
import {logX402} from "../common/debug_flags";
import {ethers} from "ethers";
import {loadWallet, withDecryptedWallet} from "../wallet/wallet_api";
import {localSet} from "../common/local_storage";
import {MsgType, X402TaskKey} from "../common/consts";

interface X402SessionKey {
    address: string
    privateKeyEnc: string      // 加密存储（不用明文）
    expiresAt: number          // 毫秒时间戳
    maxTotalAmount: string     // USDC 最多可花
    spentAmount: string        // 已花
    chainId: number            // Base / Sepolia
}

interface X402SessionAuthorization {
    sessionKey: string          // address
    owner: string               // 主钱包地址
    scope: "x402:eip3009"
    chainId: number
    maxAmount: string
    validAfter: number
    validBefore: number
}

//
// interface X402Payment {
//     authorization: EIP3009Authorization
//     sessionKeySignature: string
// }


const EIP3009_TYPES = {
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


export async function signEip3009Authorization(
    params: Eip3009AuthorizationParams
): Promise<string> {
    const {domain, message, password} = params;

    // ---------- 基础校验（防 background 传错） ----------
    if (!ethers.utils.isAddress(message.from)) {
        throw new Error("EIP-3009: from 地址非法");
    }
    if (!ethers.utils.isAddress(message.to)) {
        throw new Error("EIP-3009: to 地址非法");
    }
    if (!ethers.utils.isAddress(domain.verifyingContract)) {
        throw new Error("EIP-3009: verifyingContract 地址非法");
    }
    if (!message.value) {
        throw new Error("EIP-3009: value 不能为空");
    }
    if (!message.nonce) {
        throw new Error("EIP-3009: nonce 不能为空");
    }

    // ethers 对 bytes32 要求严格，这里统一 normalize
    const normalizedMessage = {
        from: ethers.utils.getAddress(message.from),
        to: ethers.utils.getAddress(message.to),
        value: ethers.BigNumber.from(message.value).toString(),
        validAfter: ethers.BigNumber.from(message.validAfter).toString(),
        validBefore: ethers.BigNumber.from(message.validBefore).toString(),
        nonce: ethers.utils.hexZeroPad(message.nonce, 32),
    };

    // ---------- 调用你现有的钱包解密 & TypedData 签名 ----------
    return withDecryptedWallet(password, async (wallet) => {
        const signer: any = wallet as any;

        // ethers v5 / v6 兼容
        const signFn =
            signer._signTypedData ||
            signer.signTypedData;

        if (!signFn) {
            throw new Error("当前 ethers Wallet 不支持 TypedData 签名");
        }

        const signature = await signFn.call(
            wallet,
            domain,
            EIP3009_TYPES,
            normalizedMessage
        );

        return signature;
    });
}


async function getActiveX402Session(): Promise<X402SessionKey | null> {
    // TODO: 从 chrome.storage / indexedDB 读取
    return null
}


async function requestCreateX402Session(params: {
    reason: "no_wallet" | "no_session" | "expired_session"
    tweetId: string
    authorId: string
}) {
    await localSet(X402TaskKey, {
        type: MsgType.X402SessionCreate,
        payload: params,
        createdAt: Date.now(),
    })
    await browser.action.openPopup()
}

async function signEip3009WithSessionKey(
    session: X402SessionKey,
    params: Eip3009AuthorizationParams
): Promise<string> {
    // TODO: 解密 session privateKeyEnc → 用 session key 签 TypedData
    throw new Error("session key signing not implemented")
}

export async function tipActionForTweet(data: { tweetId: string, authorId: string }) {
    logX402("------>>>tip action data:", data)
    try {
        const wallet = await loadWallet();
        if (!wallet) {
            logX402("no wallet, request create wallet");
            await requestCreateX402Session({
                reason: "no_wallet",
                tweetId: data.tweetId,
                authorId: data.authorId,
            });
            return {
                success: false,
                data: "NO_WALLET",
            };
        }

        const session = await getActiveX402Session();
        if (!session) {
            logX402("no active session, request create session");
            await requestCreateX402Session({
                reason: "no_session",
                tweetId: data.tweetId,
                authorId: data.authorId,
            });
            return {
                success: false,
                data: "NO_SESSION",
            };
        }


        const now = Date.now();
        if (session.expiresAt <= now) {
            logX402("session expired");
            await requestCreateX402Session({
                reason: "expired_session",
                tweetId: data.tweetId,
                authorId: data.authorId,
            });
            return {
                success: false,
                data: "SESSION_EXPIRED",
            };
        }

        const authorizationParams: Eip3009AuthorizationParams = {
            domain: {
                name: "USD Coin",
                version: "2",
                chainId: session.chainId,
                verifyingContract: "USDC_CONTRACT_ADDRESS", // TODO
            },
            message: {
                from: wallet.address,
                to: "FACILITATOR_OR_ROUTER_ADDRESS", // TODO
                value: "10000", // 0.01 USDC (6 decimals)
                validAfter: Math.floor(Date.now() / 1000),
                validBefore: Math.floor(Date.now() / 1000) + 300,
                nonce: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
            },
            password: "", // ❗ session key 模式下不需要主钱包密码
        };

        const signature = await signEip3009WithSessionKey(
            session,
            authorizationParams
        );

        logX402("signed with session key:", signature);

        // TODO: 发送给官方 facilitator
        return {
            success: true,
            data: signature,
        };
    } catch (err) {
        logX402("session sign failed:", err);
        return {
            success: false,
            data: "SIGN_FAILED",
        };
    }
}