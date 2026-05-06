import { isSignedIn, getAccessToken } from "@coinbase/cdp-core";
import { initCDP, resetCDPInitState, toCdpSessionError, x402_connection_name } from "../common/x402_obj";
import browser from "webextension-polyfill";
import { MsgType } from "../common/consts";
import { queryCdpWalletInfo } from "../wallet/cdp_wallet";
import { getDevicePublicKeySpkiB64 } from "../common/device_key";
import { t } from "../common/i18n";

document.addEventListener("DOMContentLoaded", async () => {
    try {
        await initCDP();
    } catch (error) {
        console.warn("[wallet_offscreen] initCDP failed:", error);
    }
});

browser.runtime.onConnect.addListener(async (port) => {
    console.log("------->>> onConnect port:", port)

    if (port.name !== x402_connection_name) {
        console.warn("------>>> unknown connection name:", port.name)
        return
    }

    port.onMessage.addListener(async (msg) => {
        try {
            await initCDP();
            let signed = await isSignedIn();

            // CDP session may not be fully rehydrated right after offscreen recreation.
            // Retry with exponential backoff before declaring "not signed in".
            if (!signed) {
                const retryDelays = [500, 1000, 1500];
                for (const delay of retryDelays) {
                    console.warn(`[wallet_offscreen] isSignedIn()=false, retrying in ${delay}ms... (attempt ${retryDelays.indexOf(delay) + 1}/${retryDelays.length})`);
                    await new Promise(r => setTimeout(r, delay));
                    resetCDPInitState(); // Force fresh CDP initialization on retry
                    await initCDP();
                    signed = await isSignedIn();
                    if (signed) break;
                }
            }

            if (signed) {
                await msgProc(port, msg);
                return;
            }

            console.warn("[wallet_offscreen] isSignedIn() still false after all retries");
            port.postMessage({
                requestId: msg.requestId,
                result: { success: false, data: t('coinbase_login_error') }
            });
        } catch (error) {
            const normalized = toCdpSessionError(error, t('coinbase_login_error'));
            console.warn("[wallet_offscreen] failed to handle wallet message:", error);
            port.postMessage({
                requestId: msg.requestId,
                result: { success: false, data: normalized.message }
            });
        }
    });
});

async function msgProc(port, msg) {

    console.log("------->>> port message:", msg)

    switch (msg.action) {
        case MsgType.WalletInfoQuery:
            const data = await queryCdpWalletInfo()
            // Guard: if queryCdpWalletInfo returned failedWallet (empty address),
            // mark as failure so the relay layer can trigger a retry.
            if (!data?.address) {
                console.warn("[wallet_offscreen] queryCdpWalletInfo returned empty address despite isSignedIn=true");
                port.postMessage({ requestId: msg.requestId, result: { success: false, data: "WALLET_QUERY_FAILED" } });
            } else {
                port.postMessage({ requestId: msg.requestId, result: { success: true, data: data } });
            }
            return

        case MsgType.DeviceKeySync: {
            try {
                const accessToken = await getAccessToken();
                if (!accessToken) {
                    port.postMessage({ requestId: msg.requestId, result: { success: false, data: "missing access token" } });
                    return;
                }
                const devicePubkey = await getDevicePublicKeySpkiB64();
                const endpoint = msg.endpoint; // passed by caller
                const response = await fetch(endpoint, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ accessToken, device_pubkey: devicePubkey }),
                    referrerPolicy: "no-referrer",
                    credentials: "omit"
                });
                if (!response.ok) {
                    const errorText = await response.text();
                    console.warn("[wallet_offscreen] DeviceKeySync failed:", response.status, errorText);
                    port.postMessage({ requestId: msg.requestId, result: { success: false, data: errorText } });
                    return;
                }
                const result = await response.json().catch(() => ({}));
                console.log("[wallet_offscreen] DeviceKeySync success:", result);
                port.postMessage({ requestId: msg.requestId, result: { success: true, data: result } });
            } catch (err: any) {
                console.error("[wallet_offscreen] DeviceKeySync error:", err);
                port.postMessage({ requestId: msg.requestId, result: { success: false, data: err.message } });
            }
            return;
        }

        default:
            port.postMessage({
                requestId: msg.requestId,
                result: { success: false, data: "unknown message type:" + msg.action }
            });
            return
    }
}
