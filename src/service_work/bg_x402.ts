import browser from "webextension-polyfill";
import {logX402} from "../common/debug_flags";
import {ethers} from "ethers";
import {loadWallet, withDecryptedWallet} from "../wallet/wallet_api";
import {localGet, localSet} from "../common/local_storage";
import {MsgType, X402TaskKey} from "../common/consts";
import {
    CdpEip3009,
    EIP3009_TYPES,
    Eip3009AuthorizationParams,
    StoredX402Session, X402_FACILITATORS,
    X402FacilitatorRequest, X402SessionKey, X402SubmitInput, X402SubmitResult
} from "../common/x402_obj";

async function getActiveX402Session(): Promise<X402SessionKey | null> {

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
    const {domain, message} = params

    // 基础校验
    if (!session.privateKey) {
        throw new Error("Session privateKey missing")
    }

    const wallet = new ethers.Wallet(session.privateKey)

    if (wallet.address.toLowerCase() !== session.address.toLowerCase()) {
        throw new Error("Session key mismatch")
    }

    // 规范化 message（ethers 对 bytes32 很严格）
    const normalizedMessage = {
        from: ethers.utils.getAddress(message.from),
        to: ethers.utils.getAddress(message.to),
        value: ethers.BigNumber.from(message.value).toString(),
        validAfter: ethers.BigNumber.from(message.validAfter).toString(),
        validBefore: ethers.BigNumber.from(message.validBefore).toString(),
        nonce: ethers.utils.hexZeroPad(message.nonce, 32),
    }

    const signFn =
        (wallet as any)._signTypedData ||
        (wallet as any).signTypedData

    if (!signFn) {
        throw new Error("Session wallet does not support typed data signing")
    }

    return await signFn.call(
        wallet,
        domain,
        EIP3009_TYPES,
        normalizedMessage
    )
}

export async function tipActionForTweet(data: { tweetId: string, authorId: string, val:number }) {// 0.01 USDC
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


        const facilitator = X402_FACILITATORS[session.chainId]
        if (!facilitator) {
            return {
                success: false,
                data: `Unsupported chainId for x402: ${session.chainId}`,
            }
        }

        if (!data.val){
            return {
                success: false,
                data: `Invalid amount to transfer  ${data.val}`,
            }
        }

        const value = BigInt(Math.floor(data.val * 1_000_000)).toString()
        const nowSec = Math.floor(Date.now() / 1000)
        const authorizationParams: Eip3009AuthorizationParams = {
            domain: {
                name: "USD Coin",
                version: "2",
                chainId: session.chainId,
                verifyingContract: facilitator.usdcAddress,
            },
            message: {
                from: wallet.address,
                to: facilitator.settlementContract,
                // value: "10000", // 0.01 USDC
                value: value,
                validAfter: nowSec,
                validBefore: nowSec + 300,
                nonce: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
            },
            password: "",
        }

        // 4️⃣ session key 签名
        const signature = await signEip3009WithSessionKey(
            session,
            authorizationParams
        )

        // 5️⃣ 更新 session 已用额度（防重放 / 防本地超额）
        session.spentAmount = (
            BigInt(session.spentAmount) +
            BigInt(authorizationParams.message.value)
        ).toString()


        const cdpEip3009: CdpEip3009 = {
            from: authorizationParams.message.from,
            to: authorizationParams.message.to,
            value: authorizationParams.message.value,
            validAfter: authorizationParams.message.validAfter,
            validBefore: authorizationParams.message.validBefore,
            nonce: authorizationParams.message.nonce,
            signature,
        }



        return {
            success: false,
            data: "submitResult",
        }
    } catch (err) {
        logX402("session sign failed:", err);
        return {
            success: false,
            data: "SIGN_FAILED",
        };
    }
}

export async function submitToX402Facilitator(
    input: X402SubmitInput
): Promise<X402SubmitResult> {
    const { facilitator, sessionAuthorization, transfer } = input

    const body: X402FacilitatorRequest = {
        sessionAuthorization: {
            payload: sessionAuthorization.payload,
            signature: sessionAuthorization.signature,
        },
        transferAuthorization: {
            from: transfer.from,
            to: transfer.to,
            value: transfer.value,
            validAfter: transfer.validAfter,
            validBefore: transfer.validBefore,
            nonce: transfer.nonce,
            signature: transfer.signature,
        },
    }

    let resp: Response
    try {
        resp = await fetch(facilitator.endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
        })
    } catch (err) {
        return {
            ok: false,
            error: "NETWORK_ERROR",
            message: String(err),
        }
    }

    let json: any
    try {
        json = await resp.json()
    } catch {
        return {
            ok: false,
            error: "UNKNOWN_ERROR",
            message: "Invalid JSON response from facilitator",
        }
    }

    // === 成功路径 ===
    if (resp.ok && json?.txHash) {
        return {
            ok: true,
            txHash: json.txHash,
            status: json.confirmed ? "confirmed" : "submitted",
        }
    }

    // === 错误映射（非常重要，商用必须） ===
    const code = json?.errorCode || json?.code

    switch (code) {
        case "INVALID_SESSION":
        case "SESSION_EXPIRED":
            return { ok: false, error: "SESSION_EXPIRED", message: json.message }

        case "INVALID_AUTH":
        case "INVALID_SIGNATURE":
            return { ok: false, error: "INVALID_AUTHORIZATION", message: json.message }

        case "INSUFFICIENT_FUNDS":
            return { ok: false, error: "INSUFFICIENT_FUNDS", message: json.message }

        case "REJECTED":
            return { ok: false, error: "FACILITATOR_REJECTED", message: json.message }

        default:
            return {
                ok: false,
                error: "UNKNOWN_ERROR",
                message: json?.message || "Unknown facilitator error",
            }
    }
}
