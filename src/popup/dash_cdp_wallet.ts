import {$Id} from "./common";
import {formatEther} from 'viem';
import {createPublicClient, http} from 'viem';
import {base} from 'viem/chains';
import browser from "webextension-polyfill";
import {doSignOut, tryGetSignedInUser} from "../common/x402_obj";


// Base 主网配置
const BASE_RPC_URL = 'https://mainnet.base.org';
const USDC_ADDRESS_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const;

const publicClient = createPublicClient({
    chain: base,
    transport: http(BASE_RPC_URL),
});

const usdcAbi = [
    {
        constant: true,
        inputs: [{name: '_owner', type: 'address'}],
        name: 'balanceOf',
        outputs: [{name: 'balance', type: 'uint256'}],
        type: 'function',
    },
] as const;

export async function refreshWalletBalance(address: string): Promise<void> {
    if (!address || address === '未知') {
        console.log('无有效地址，无法刷新余额');
        return;
    }

    try {
        // ETH 余额（不受影响）
        const ethBalanceRaw = await publicClient.getBalance({
            address: address as `0x${string}`
        });
        const ethBalance = formatEther(ethBalanceRaw);

        const ethEl = document.querySelector('.wallet-eth-value') as HTMLElement;
        if (ethEl) ethEl.innerText = Number(ethBalance).toFixed(6);

        // USDC 余额（关键修复）
        const usdcBalanceRaw = await publicClient.readContract({
            address: USDC_ADDRESS_BASE,
            abi: usdcAbi,
            functionName: 'balanceOf',
            args: [address as `0x${string}`],
            authorizationList: undefined,  // ← 必须加这行，消除 TS2345
        }) as bigint;

        const usdcBalance = Number(usdcBalanceRaw) / 1_000_000;

        const usdtEl = document.querySelector('.wallet-usdt-value') as HTMLElement;
        if (usdtEl) usdtEl.innerText = usdcBalance.toFixed(2);

        console.log(`余额更新: ETH ${ethBalance}, USDC ${usdcBalance}`);
    } catch (error) {
        console.error('刷新余额失败', error);
        const ethEl = document.querySelector('.wallet-eth-value') as HTMLElement;
        const usdtEl = document.querySelector('.wallet-usdt-value') as HTMLElement;
        if (ethEl) ethEl.innerText = '--';
        if (usdtEl) usdtEl.innerText = '--';
    }
}

export async function bindOpenAuthPage() {
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


function renderAuthState(user: any) {
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
}
