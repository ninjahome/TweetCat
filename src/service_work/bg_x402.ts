import browser from "webextension-polyfill";
import {logX402} from "../common/debug_flags";
import {ethers} from "ethers";
import {loadWalletSettings, walletStatus} from "../wallet/wallet_api";
import {BASE_MAINNET_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID, MsgType} from "../common/consts";
import {
    CdpEip3009, ChainNameBaseMain,
    EIP3009_TYPES,
    Eip3009AuthorizationParams, MAX_TIP_AMOUNT,
    X402_FACILITATORS, X402PopupTask,
    X402SubmitInput, X402SubmitResult, X402TaskKey
} from "../common/x402_obj";
import {localSet} from "../common/local_storage";

async function signEip3009WithMainWallet(
    params: Eip3009AuthorizationParams, wallet: ethers.Wallet
): Promise<string> {
    const {domain, message} = params;


    const normalizedMessage = {
        from: ethers.utils.getAddress(message.from),
        to: ethers.utils.getAddress(message.to),
        value: ethers.BigNumber.from(message.value).toString(),
        validAfter: ethers.BigNumber.from(message.validAfter).toString(),
        validBefore: ethers.BigNumber.from(message.validBefore).toString(),
        nonce: ethers.utils.hexZeroPad(message.nonce, 32),
    };

    return wallet._signTypedData(
        domain,
        EIP3009_TYPES,
        normalizedMessage
    );
}

export async function tipActionForTweet(data: {
    tweetId: string;
    authorId: string;
    val: number;
}) {
    logX402("------>>> tip action data:", data);

    try {
        // 1️⃣ 查询钱包运行态
        const status = await walletStatus();

        if (status.status === "NO_WALLET") {
            return {success: false, data: "NO_WALLET"};
        }

        // 2️⃣ 如果没解锁 → 让 popup 弹密码
        if (status.status === "LOCKED" || status.status === "EXPIRED") {

            const task: X402PopupTask = {
                type: MsgType.X402WalletOpen,
                createdAt: Date.now(),
                payload: {
                    tweetId: data.tweetId,
                    authorId: data.authorId,
                },
            }

            await localSet(X402TaskKey, task);
            await browser.action.openPopup();
            return {success: false, data: "WALLET_LOCKED"};
        }
        const wallet = status.wallet;

        // 3️⃣ UNLOCKED：继续
        if (status.status !== "UNLOCKED" || !wallet) {
            return {success: false, data: "INVALID_WALLET_STATE"};
        }

        if (!data.val || data.val <= 0 || data.val > MAX_TIP_AMOUNT) {
            return {success: false, data: "INVALID_AMOUNT"};
        }

        const walletSetting = await loadWalletSettings()
        const chainId =
            walletSetting.network === ChainNameBaseMain
                ? BASE_MAINNET_CHAIN_ID
                : BASE_SEPOLIA_CHAIN_ID;
        const facilitator = X402_FACILITATORS[chainId];
        if (!facilitator) {
            return {
                success: false,
                data: `Unsupported chainId for x402: ${chainId}`,
            };
        }

        // 4️⃣ 构造 EIP-3009
        const value = BigInt(Math.floor(data.val * 1_000_000)).toString();
        const nowSec = Math.floor(Date.now() / 1000);

        const authorizationParams: Eip3009AuthorizationParams = {
            domain: {
                name: "USD Coin",
                version: "2",
                chainId,
                verifyingContract: facilitator.usdcAddress,
            },
            message: {
                from: status.address!, // 主钱包地址
                to: facilitator.settlementContract,
                value,
                validAfter: nowSec,
                validBefore: nowSec + 300,
                nonce: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
            },
            password: "",
        };

        // 5️⃣ 主钱包私钥签名
        const signature = await signEip3009WithMainWallet(
            authorizationParams, wallet
        );

        const transfer: CdpEip3009 = {
            from: authorizationParams.message.from,
            to: authorizationParams.message.to,
            value: authorizationParams.message.value,
            validAfter: authorizationParams.message.validAfter,
            validBefore: authorizationParams.message.validBefore,
            nonce: authorizationParams.message.nonce,
            signature,
        };

        // 6️⃣ 提交给官方 facilitator
        const submitResult = await submitToX402Facilitator({
            facilitator,
            transfer,
        });

        return {
            success: submitResult.ok,
            data: submitResult,
        };
    } catch (err) {
        logX402("x402 sign failed:", err);
        return {success: false, data: "SIGN_FAILED"};
    }
}

export async function submitToX402Facilitator(
    input: X402SubmitInput
): Promise<X402SubmitResult> {
    const {facilitator, transfer} = input;

    const body = {
        transferAuthorization: transfer,
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    let resp: Response
    try {
        resp = await fetch(facilitator.endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            signal: controller.signal,
            body: JSON.stringify(body),
        })
    } catch (err) {
        return {
            ok: false,
            error: "NETWORK_ERROR",
            message: String(err),
        }
    } finally {
        clearTimeout(timeout);
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
            return {ok: false, error: "SESSION_EXPIRED", message: json.message}

        case "INVALID_AUTH":
        case "INVALID_SIGNATURE":
            return {ok: false, error: "INVALID_AUTHORIZATION", message: json.message}

        case "INSUFFICIENT_FUNDS":
            return {ok: false, error: "INSUFFICIENT_FUNDS", message: json.message}

        case "REJECTED":
            return {ok: false, error: "FACILITATOR_REJECTED", message: json.message}

        default:
            return {
                ok: false,
                error: "UNKNOWN_ERROR",
                message: json?.message || "Unknown facilitator error",
            }
    }
}

let heartBeatCounter = 0

export async function x402HeartResponse() {
    console.log("------>>>keep alive success", heartBeatCounter++)
    return {success: true, data: "success" + heartBeatCounter}
}