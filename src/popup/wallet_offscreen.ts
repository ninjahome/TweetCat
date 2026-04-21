import {isSignedIn} from "@coinbase/cdp-core";
import {initCDP, toCdpSessionError, x402_connection_name} from "../common/x402_obj";
import browser from "webextension-polyfill";
import {MsgType} from "../common/consts";
import {queryCdpWalletInfo} from "../wallet/cdp_wallet";
import {t} from "../common/i18n";

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
            // Retry once after a brief pause before declaring "not signed in".
            if (!signed) {
                console.warn("[wallet_offscreen] isSignedIn() returned false, retrying in 800ms...");
                await new Promise(r => setTimeout(r, 800));
                await initCDP();
                signed = await isSignedIn();
            }

            if (signed) {
                await msgProc(port, msg);
                return;
            }

            console.warn("[wallet_offscreen] isSignedIn() still false after retry");
            port.postMessage({
                requestId: msg.requestId,
                result: {success: false, data: t('coinbase_login_error')}
            });
        } catch (error) {
            const normalized = toCdpSessionError(error, t('coinbase_login_error'));
            console.warn("[wallet_offscreen] failed to handle wallet message:", error);
            port.postMessage({
                requestId: msg.requestId,
                result: {success: false, data: normalized.message}
            });
        }
    });
});

async function msgProc(port, msg) {

    console.log("------->>> port message:", msg)

    switch (msg.action) {
        case MsgType.WalletInfoQuery:
            const data = await queryCdpWalletInfo()
            port.postMessage({requestId: msg.requestId, result: {success: true, data: data}});
            return

        default:
            port.postMessage({
                requestId: msg.requestId,
                result: {success: false, data: "unknown message type:" + msg.action}
            });
            return
    }
}
