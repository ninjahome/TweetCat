import browser from "webextension-polyfill";
import {logX402} from "../common/debug_flags";
import {loadWalletSettings} from "../wallet/wallet_api";
import {BASE_MAINNET_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID} from "../common/consts";
import {
    ChainNameBaseMain,
    MAX_TIP_AMOUNT, tryGetSignedInUser, X402_FACILITATORS,
    x402TipPayload
} from "../common/x402_obj";
import {fetchWithX402} from "@coinbase/cdp-core";

const WORKER_URL = "https://tweetcattips.ribencong.workers.dev";

const { fetchWithPayment } = fetchWithX402({
    // 可选：限制单笔最大支付（安全）
    // maxValue: parseUnits("10", 6), // 最大 10 USDC
});
export async function tipActionForTweet(data: x402TipPayload) {
    logX402("------>>> Starting x402 tip action with Embedded Wallet:", data);

    try {
        const user = await tryGetSignedInUser();
        if (!user || !user.evmAccounts?.length) {
            logX402("Wallet not connected, opening login...");
            // 打开登录页
            await browser.tabs.create({
                url: browser.runtime.getURL("html/cdp_auth.html")
            });
            return { success: false, data: "WALLET_NOT_CONNECTED" };
        }

        const address = user.evmAccounts[0];
        logX402("User connected:", address);

        if (!data.usdcVal || data.usdcVal <= 0 || data.usdcVal > MAX_TIP_AMOUNT) {
            return {success: false, data: "INVALID_AMOUNT"};
        }

        const walletSetting = await loadWalletSettings();
        const chainId =
            walletSetting.network === ChainNameBaseMain
                ? BASE_MAINNET_CHAIN_ID
                : BASE_SEPOLIA_CHAIN_ID;
        const settleAddress = X402_FACILITATORS[chainId].settlementContract
        const tipUrl = `${WORKER_URL}/tip?payTo=${settleAddress}&amount=${data.usdcVal}`;
        logX402("Step 1: Requesting 402 from Worker...");
        const response = await fetchWithPayment(tipUrl, {
            method: 'GET',  // 或 POST，根据你的 Worker
        });

        if (!response.ok) {
            const errText = await response.text();
            logX402("x402 payment failed:", response.status, errText);
            return { success: false, data: "PAYMENT_FAILED", message: errText };
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

export async function walletSignedIn(): Promise<string> {
    console.log("------>>> wallet signed success!")
    return "success"
}