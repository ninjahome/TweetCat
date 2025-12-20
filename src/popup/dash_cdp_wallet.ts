import {$Id} from "./common";
import browser from "webextension-polyfill";
import {ChainIDBaseSepolia, ChainNameBaseSepolia, doSignOut, tryGetSignedInUser} from "../common/x402_obj";
import {queryWalletBalance} from "../wallet/cdp_wallet";
import {t} from "../common/i18n";

export async function refreshWalletBalance(
    address: string,
    networkId: number,
): Promise<void> {

    const ethEl = document.querySelector('.wallet-eth-value') as HTMLElement
    const usdcEl = document.querySelector('.wallet-usdt-value') as HTMLElement

    try {
        const balance = await queryWalletBalance(address, networkId)

        if (ethEl) ethEl.innerText = balance.eth
        if (usdcEl) usdcEl.innerText = balance.usdc

        console.log(`[${networkId}] balance updated`, balance)
    } catch (err) {
        console.error('刷新余额失败', err)
        if (ethEl) ethEl.innerText = '--'
        if (usdcEl) usdcEl.innerText = '--'
    }
}

export async function initCdpWallet() {

    // const walletCreateDiv = $Id("wallet-create-div") as HTMLButtonElement;//btn-create-wallet
    // const walletInfoDiv = $Id("wallet-info-area") as HTMLDivElement;
    // const walletSettingBtn = $Id("wallet-settings-btn") as HTMLButtonElement;
    // const walletMainBtn = $Id("btn-main-menu") as HTMLButtonElement;
    // const walletMainMenu = $Id("wallet-main-menu") as HTMLDivElement;
    //
    //
    // const walletNewBtn = (walletCreateDiv.querySelector(".btn-create-wallet") as HTMLButtonElement);
    // walletNewBtn.textContent = t('cdp_wallet_connect');
    //
    // tryGetSignedInUser().then(user=>{
    //     if(!user){
    //
    //     }
    // })
    //


    const btnLogin = $Id("btn-open-cdp-auth") as HTMLButtonElement;
    const btnLogout = $Id("btn-cdp-signout") as HTMLButtonElement;

    // 👉 登录：打开 OAuth 页面
    btnLogin.onclick = async () => {
        const url = browser.runtime.getURL("html/cdp_auth.html");
        await browser.tabs.create({url});
    };

    // 👉 退出登录
    btnLogout.onclick = async () => {
        btnLogout.disabled = true;
        try {
            await doSignOut();
        } finally {
            btnLogout.disabled = false;
            renderAuthState(null);
        }
    };

    // 👉 初始化时判断登录态
    const user = await tryGetSignedInUser();
    renderAuthState(user);
}


async function renderAuthState(user: any) {
    const btnLogin = $Id("btn-open-cdp-auth") as HTMLButtonElement;
    const btnLogout = $Id("btn-cdp-signout") as HTMLButtonElement;
    const statusEl = $Id("cdp-auth-status") as HTMLElement;

    console.log("------>>>:", user)
    if (!user || !user.evmAccounts?.length) {
        // ❌ 未登录
        btnLogin.style.display = "block";
        btnLogout.style.display = "none";
        statusEl.innerText = "未连接";
        return;
    }

    // ✅ 已登录
    const address = user.evmAccounts[0];
    btnLogin.style.display = "none";
    btnLogout.style.display = "block";
    statusEl.innerText = `已连接：${address.slice(0, 6)}...${address.slice(-4)}`;
    console.log("------>>> embedded cdp wallet address:",
        address,
        user.authenticationMethods,
        await queryWalletBalance(address, ChainIDBaseSepolia))
}
