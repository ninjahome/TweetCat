import browser from "webextension-polyfill";
import {logX402} from "../common/debug_flags";
import {ethers} from "ethers";
import {loadWalletSettings} from "../wallet/wallet_api";
import {BASE_MAINNET_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID, MsgType} from "../common/consts";
import {
    ChainNameBaseMain,
    EIP3009_TYPES,
    Eip3009AuthorizationParams, MAX_TIP_AMOUNT,
    X402PopupTask,
    X402SubmitResult, X402TaskKey, x402TipPayload
} from "../common/x402_obj";
import {localSet} from "../common/local_storage";
import {getSessionWallet} from "./session_wallet";

// 🔴 重要：请替换为你的实际 Worker URL
const WORKER_URL = "https://tweetcattips.ribencong.workers.dev";

// x402 Payment Required 响应结构
interface X402PaymentRequired {
    x402Version: number;
    accepts: Array<{
        scheme: string;
        network: string;
        asset: string;
        payTo: string;
        price: string;
    }>;
}

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

/**
 * 步骤 1: 请求 Worker 获取 402 Payment Required
 */
async function fetch402PaymentRequired(
    payTo: string,
    amount: number
): Promise<X402PaymentRequired | null> {
    try {
        const url = `${WORKER_URL}/tip?payTo=${payTo}&amount=${amount}`;
        logX402("Fetching 402 from:", url);
        
        const resp = await fetch(url, {
            method: 'GET',
        });

        if (resp.status !== 402) {
            logX402('Expected 402, got:', resp.status);
            return null;
        }

        const header = resp.headers.get('PAYMENT-REQUIRED');
        if (!header) {
            logX402('Missing PAYMENT-REQUIRED header');
            return null;
        }

        const decoded = JSON.parse(atob(header));
        logX402('Got payment requirements:', decoded);
        return decoded;
    } catch (err) {
        logX402('Failed to fetch 402:', err);
        return null;
    }
}

/**
 * 步骤 2: 提交支付签名给 Worker
 */
async function submitPaymentToWorker(
    payTo: string,
    amount: number,
    paymentSignature: any
): Promise<X402SubmitResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
        const url = `${WORKER_URL}/tip?payTo=${payTo}&amount=${amount}`;
        logX402("Submitting payment to:", url);
        
        const resp = await fetch(url, {
            method: 'GET',
            headers: {
                'PAYMENT-SIGNATURE': btoa(JSON.stringify(paymentSignature)),
            },
            signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!resp.ok) {
            const text = await resp.text();
            logX402('Worker error:', resp.status, text);
            return {
                ok: false,
                error: 'WORKER_ERROR',
                message: text,
            };
        }

        const json = await resp.json();
        logX402('Worker response:', json);
        
        if (json.ok && json.txHash) {
            return {
                ok: true,
                txHash: json.txHash,
                status: 'submitted',
            };
        }

        return {
            ok: false,
            error: 'UNKNOWN_ERROR',
            message: json.error || 'Unknown error',
        };
    } catch (err) {
        clearTimeout(timeout);
        logX402('Network error:', err);
        return {
            ok: false,
            error: 'NETWORK_ERROR',
            message: String(err),
        };
    }
}

/**
 * 主流程：标准 x402 打赏流程
 */
export async function tipActionForTweet(data: x402TipPayload) {
    logX402("------>>> Starting x402 tip action:", data);

    try {
        // 1️⃣ 检查钱包
        const wallet = await getSessionWallet();
        if (!wallet) {
            logX402("Wallet locked, opening popup...");
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

        if (!data.usdcVal || data.usdcVal <= 0 || data.usdcVal > MAX_TIP_AMOUNT) {
            return {success: false, data: "INVALID_AMOUNT"};
        }

        const walletSetting = await loadWalletSettings();
        const chainId =
            walletSetting.network === ChainNameBaseMain
                ? BASE_MAINNET_CHAIN_ID
                : BASE_SEPOLIA_CHAIN_ID;

        // 2️⃣ 第一步：请求 Worker 获取 402 Payment Required
        logX402("Step 1: Requesting 402 from Worker...");
        const paymentRequired = await fetch402PaymentRequired(
            "0x06856d7a17b0ac072a845fbe95812e94ef8c2411",
            data.usdcVal
        );
        
        if (!paymentRequired) {
            return {success: false, data: "FAILED_TO_GET_402"};
        }

        // 3️⃣ 从 402 响应中提取支付参数
        const accept = paymentRequired.accepts[0];
        if (!accept) {
            return {success: false, data: "INVALID_402_RESPONSE"};
        }

        // 解析 price (格式: "$0.50")
        const priceStr = accept.price.replace('$', '');
        const usdcAmount = parseFloat(priceStr);
        const value = BigInt(Math.floor(usdcAmount * 1_000_000)).toString();
        const nowSec = Math.floor(Date.now() / 1000);

        // 4️⃣ 构造 EIP-3009 授权（根据 402 响应）
        logX402("Step 2: Building EIP-3009 authorization...");
        const authorizationParams: Eip3009AuthorizationParams = {
            domain: {
                name: "USD Coin",
                version: "2",
                chainId,
                verifyingContract: accept.asset, // 来自 402
            },
            message: {
                from: wallet.address!,
                to: accept.payTo, // 来自 402
                value,
                validAfter: nowSec,
                validBefore: nowSec + 300,
                nonce: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
            },
            password: "",
        };

        // 5️⃣ 签名
        logX402("Step 3: Signing EIP-3009 authorization...");
        const signature = await signEip3009WithMainWallet(
            authorizationParams,
            wallet
        );

        // 6️⃣ 构造 payment signature (x402 标准格式)
        const paymentSignature = {
            scheme: 'eip3009',
            network: accept.network,
            asset: accept.asset,
            authorization: {
                from: authorizationParams.message.from,
                to: authorizationParams.message.to,
                value: authorizationParams.message.value,
                validAfter: authorizationParams.message.validAfter,
                validBefore: authorizationParams.message.validBefore,
                nonce: authorizationParams.message.nonce,
                signature,
            },
        };

        // 7️⃣ 第二步：带签名请求 Worker 完成支付
        logX402("Step 4: Submitting payment to Worker...");
        const result = await submitPaymentToWorker(
            "0x06856d7a17b0ac072a845fbe95812e94ef8c2411",
            data.usdcVal,
            paymentSignature
        );

        logX402("Payment result:", result);
        return {
            success: result.ok,
            data: result,
        };
    } catch (err) {
        logX402("x402 payment failed:", err);
        return {success: false, data: "PAYMENT_FAILED"};
    }
}

