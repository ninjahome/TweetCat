import {isSignedIn} from "@coinbase/cdp-core";
import {initCDP, x402_connection_name} from "../common/x402_obj";
import browser from "webextension-polyfill";
import {MsgType} from "../common/consts";
import {queryCdpWalletInfo} from "../wallet/cdp_wallet";
import {sendMsgToService} from "../common/utils";
import {t} from "../common/i18n";

document.addEventListener("DOMContentLoaded", async () => {
    await initCDP();
});

browser.runtime.onConnect.addListener(async (port) => {
    console.log("------->>> onConnect port:", port)

    if (port.name !== x402_connection_name) {
        console.warn("------>>> unknown connection name:", port.name)
        return
    }

    port.onMessage.addListener(async (msg) => {
        await initCDP();
        const signed = await isSignedIn()
        if (signed) {
            await msgProc(port, msg)
            return
        }

        port.postMessage({
            requestId: msg.requestId,
            result: {success: false, data: t('coinbase_login_error')}
        });

        await sendMsgToService({}, MsgType.X402NotSignedIn)
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
