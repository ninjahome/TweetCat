import {fetchWithX402, getCurrentUser} from "@coinbase/cdp-core";
import {initCDP, tryGetSignedInUser} from "../common/x402_obj";
import browser from "webextension-polyfill";
import {MsgType} from "../common/consts";
import {queryCdpWalletInfo} from "../wallet/cdp_wallet";

const WORKER_URL = "https://tweetcattips.ribencong.workers.dev";

const {fetchWithPayment} = fetchWithX402({
    // 可选：限制单笔最大支付（安全）
    // maxValue: parseUnits("10", 6), // 最大 10 USDC
});

let inited = false;

async function ensureWalletReady() {
    if (inited) return;
    await initCDP();
    inited = true;
    const user = await getCurrentUser();
    console.log("Offscreen Wallet SDK initialized:",user);
}

ensureWalletReady().then()

browser.runtime.onConnect.addListener((port) => {
    console.log("------->>> onConnect port:", port)

    if (port.name === "wallet-offscreen") {
        port.onMessage.addListener(async (msg) => {
            console.log("------->>> port message:", msg)

            switch (msg.action) {
                case MsgType.OffscreenWalletInfo:
                    const data = await queryCdpWalletInfo()
                    port.postMessage({type: "TIP_RESULT", result: {success: true, data: data}});
                    break

                case MsgType.OffscreenWalletSignIn:
                    await initCDP();
                    console.log("Offscreen wallet signIn success:",await getCurrentUser());
                    break
            }
        });
    }
});