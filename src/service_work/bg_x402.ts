import browser from "webextension-polyfill";
import {
    x402_connection_name, x402TipPayload
} from "../common/x402_obj";

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
    const port = browser.runtime.connect({name: x402_connection_name});

    port.onMessage.addListener(handleOffScreenMsg);

    port.onDisconnect.addListener(() => {
        console.warn("Offscreen connection lost");
        walletPort = null;
        for (const [_, entry] of pendingWalletResponses) {
            clearTimeout(entry.timeout);
            entry.resolve({success: false, error: 'Connection lost'});
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
                resolve({success: false, error: 'wallet timeout'});
            }
        }, 15000); // 考虑到 CDP 转账确认，建议拉长到 15s

        pendingWalletResponses.set(requestId, {resolve, timeout});

        try {
            port.postMessage({...request, requestId});
        } catch (err) {
            clearTimeout(timeout);
            pendingWalletResponses.delete(requestId);
            resolve({success: false, error: 'Post message failed'});
        }
    });
}

export async function tipActionForTweet(payload: x402TipPayload) {

    try {
        const url = browser.runtime.getURL(`html/x402_pay.html?payload=${encodeURIComponent(JSON.stringify(payload))}`)

        const width = 450;
        const height = 650;

        const currentWindow = await browser.windows.getLastFocused();

        let left = 0;
        let top = 0;

        if (currentWindow.width && currentWindow.height) {
            // 计算相对于当前浏览器窗口的居中位置
            left = Math.round(currentWindow.left! + (currentWindow.width - width) / 2);
            top = Math.round(currentWindow.top! + (currentWindow.height - height) / 2);
        }

        await browser.windows.create({
            url,
            type: 'popup',
            width,
            height,
            left,
            top,
            focused: true
        });

        return {success: true};
    } catch (e) {
        console.log("open payment url failed:", e)
        return {success: false, data: e.toString()};
    }
}