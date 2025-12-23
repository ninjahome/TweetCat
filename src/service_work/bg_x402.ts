import browser from "webextension-polyfill";
import {logX402} from "../common/debug_flags";
import {
    MAX_TIP_AMOUNT, x402_connection_name, X402_FACILITATORS,
    x402TipPayload
} from "../common/x402_obj";
import {fetchWithX402} from "@coinbase/cdp-core";
import {getChainId} from "../wallet/wallet_setting";
import {getWalletAddress} from "../wallet/cdp_wallet";

const WORKER_URL = "https://tweetcattips.ribencong.workers.dev";

const {fetchWithPayment} = fetchWithX402({
    // 可选：限制单笔最大支付（安全）
    // maxValue: parseUnits("10", 6), // 最大 10 USDC
});

export async function tipActionForTweet(data: x402TipPayload) {
    logX402("------>>> Starting x402 tip action with Embedded Wallet:", data);

    try {
        const address = await getWalletAddress();
        if (!address) {
            logX402("Wallet not connected, opening login...");
            // 打开登录页
            await browser.tabs.create({
                url: browser.runtime.getURL("html/cdp_auth.html")
            });
            return {success: false, data: "WALLET_NOT_CONNECTED"};
        }

        logX402("User connected:", address);

        if (!data.usdcVal || data.usdcVal <= 0 || data.usdcVal > MAX_TIP_AMOUNT) {
            return {success: false, data: "INVALID_AMOUNT"};
        }

        const chainId = await getChainId();
        const settleAddress = X402_FACILITATORS[chainId].settlementContract
        const tipUrl = `${WORKER_URL}/tip?payTo=${settleAddress}&amount=${data.usdcVal}`;
        logX402("Step 1: Requesting 402 from Worker...");
        const response = await fetchWithPayment(tipUrl, {
            method: 'GET',  // 或 POST，根据你的 Worker
        });

        if (!response.ok) {
            const errText = await response.text();
            logX402("x402 payment failed:", response.status, errText);
            return {success: false, data: "PAYMENT_FAILED", message: errText};
        }

        const result = await response.json();
        logX402("x402 payment success:", result);

        return {
            success: true,
            data: {
                ok: true,
                txHash: result.txHash,
                status: 'completed',
            },
        };

    } catch (err) {
        logX402("x402 payment failed:", err);
        return {success: false, data: "PAYMENT_FAILED"};
    }
}

export async function restartOffScreen(): Promise<string> {
    await browser.offscreen.closeDocument();
    await ensureOffscreenWallet();
    return "success"
}

export async function ensureOffscreenWallet() {
    const has = await browser.offscreen.hasDocument();
    if (!has) {
        const tab = await browser.offscreen.createDocument({
            url: browser.runtime.getURL('html/wallet_offscreen.html'),
            reasons: ['DOM_PARSER'], // 或 'WORKERS', 'IFRAME_SCRIPTING'
            justification: 'Run Coinbase Embedded Wallets SDK for background x402 payments',
        });
        console.log("Offscreen wallet created", tab);
    } else {
        console.log("Offscreen wallet is ready");
    }
}


export let walletPort: browser.runtime.Port | null = null;
const pendingWalletResponses = new Map<string, PendingEntry>();

type PendingEntry = {
    resolve: (resp: any) => void;
    timeout: ReturnType<typeof setTimeout>;
};

function handleOffScreenMsg(msg: any) {
    if (!msg?.requestId) return;
    const pending = pendingWalletResponses.get(msg.requestId);
    if (!pending) return;

    pending.resolve(msg.result);
    clearTimeout(pending.timeout);
    pendingWalletResponses.delete(msg.requestId);
}

function createPort() {
    const port = browser.runtime.connect({ name: x402_connection_name });

    port.onMessage.addListener(handleOffScreenMsg);

    port.onDisconnect.addListener(() => {
        console.warn("Offscreen connection lost");
        walletPort = null;
        for (const [_, entry] of pendingWalletResponses) {
            clearTimeout(entry.timeout);
            entry.resolve({ success: false, error: 'Connection lost' });
        }
        pendingWalletResponses.clear();  // 一键清空
    });

    return port;
}

function getPort(): browser.runtime.Port {
    if (!walletPort) {
        walletPort = createPort();
    }
    return walletPort;
}

export async function relayWalletMsg(request: any): Promise<any> {
    await ensureOffscreenWallet();

    const port = getPort();
    const requestId = crypto.randomUUID();

    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            if (pendingWalletResponses.has(requestId)) {
                pendingWalletResponses.delete(requestId);
                resolve({ success: false, error: 'wallet timeout' });
            }
        }, 15000); // 考虑到 CDP 转账确认，建议拉长到 15s

        pendingWalletResponses.set(requestId, { resolve, timeout });

        try {
            port.postMessage({ ...request, requestId });
        } catch (err) {
            clearTimeout(timeout);
            pendingWalletResponses.delete(requestId);
            resolve({ success: false, error: 'Post message failed' });
        }
    });
}