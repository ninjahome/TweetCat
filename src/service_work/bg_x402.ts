import browser from "webextension-polyfill";
import {
    x402_connection_name, x402TipPayload
} from "../common/x402_obj";
import {MsgType} from "../common/consts";
import {logX402} from "../common/debug_flags";
import {showPopupWindow} from "../popup/common";
import {UserProfile} from "../object/user_info";

export async function restartOffScreen(): Promise<string> {
    await browser.offscreen.closeDocument();
    await ensureOffscreenWallet();
    await browser.action.openPopup()
    return "success"
}

export async function ensureOffscreenWallet() {
    const has = await browser.offscreen.hasDocument();
    if (!has) {
        // Offscreen was GC'd or never created → invalidate stale port
        if (walletPort) {
            logX402("Offscreen missing but walletPort exists → clearing stale port");
            try { walletPort.disconnect(); } catch (_) { /* already dead */ }
            walletPort = null;
        }
        const tab = await browser.offscreen.createDocument({
            url: browser.runtime.getURL('html/wallet_offscreen.html'),
            reasons: ['DOM_PARSER'], // 或 'WORKERS', 'IFRAME_SCRIPTING'
            justification: 'Run Coinbase Embedded Wallets SDK for background x402 payments',
        });
        logX402("Offscreen wallet created", tab);
    } else {
        logX402("Offscreen wallet is ready");
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

async function relayOnce(request: any): Promise<any> {
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

export async function relayWalletMsg(request: any): Promise<any> {
    const result = await relayOnce(request);

    // If the first attempt failed (likely stale port or CDP session not ready),
    // retry once after a brief pause to give the offscreen document time to initialize.
    if (!result?.success && request.action === MsgType.WalletInfoQuery) {
        const errHint = result?.error || result?.data || '';
        logX402(`[relayWalletMsg] WalletInfoQuery failed (${errHint}), retrying once in 1.5s...`);

        // Force port reconnection in case the old one was stale
        if (walletPort) {
            try { walletPort.disconnect(); } catch (_) { /* ok */ }
            walletPort = null;
        }

        // Destroy the offscreen document so relayOnce creates a fresh one
        // with a clean CDP instance (the old one's isSignedIn() may be stuck)
        try { await browser.offscreen.closeDocument(); } catch (_) { /* may already be gone */ }

        await new Promise(r => setTimeout(r, 1500));
        return await relayOnce(request);
    }

    return result;
}

export async function tipActionForTweet(payload: x402TipPayload) {

    try {
        const url = browser.runtime.getURL(`html/x402_pay.html?payload=${encodeURIComponent(JSON.stringify(payload))}`)
        await showPopupWindow(url)
        return {success: true};
    } catch (e) {
        console.log("open payment url failed:", e)
        return {success: false, data: e.toString()};
    }
}


export async function msgTransferUsdcByTwitter(userProfile: UserProfile) {
    try {
        const url = browser.runtime.getURL(`html/x402_transfer.html?payload=${encodeURIComponent(JSON.stringify(userProfile))}`)
        await showPopupWindow(url)
        return {success: true};
    } catch (e) {
        console.log("open payment url failed:", e)
        return {success: false, data: e.toString()};
    }
}

/**
 * Sync device public key to the backend via offscreen document.
 * The offscreen has a valid CDP session (getAccessToken works),
 * unlike the service worker where CDP auth state is unavailable.
 */
export async function syncDeviceKeyViaOffscreen(validateTokenUrl: string): Promise<boolean> {
    try {
        const result = await relayOnce({
            action: MsgType.DeviceKeySync,
            endpoint: validateTokenUrl,
        });
        logX402("[syncDeviceKeyViaOffscreen] result:", result);
        return result?.success === true;
    } catch (err) {
        console.error("[syncDeviceKeyViaOffscreen] error:", err);
        return false;
    }
}