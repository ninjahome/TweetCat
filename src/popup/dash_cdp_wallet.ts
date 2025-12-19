import { $Id } from "./common";
import { formatEther } from 'viem';
import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';
import browser from "webextension-polyfill";  // 主网
import {
    initialize,
    getCurrentUser,
    signOut,
    type Config,
} from "@coinbase/cdp-core";


// Base 主网配置
const BASE_RPC_URL = 'https://mainnet.base.org';
const USDC_ADDRESS_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const;

const publicClient = createPublicClient({
    chain: base,
    transport: http(BASE_RPC_URL),
});

// USDC 最小 ABI
const usdcAbi = [
    {
        constant: true,
        inputs: [{ name: '_owner', type: 'address' }],
        name: 'balanceOf',
        outputs: [{ name: 'balance', type: 'uint256' }],
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
    const btn = $Id("btn-open-cdp-auth") as HTMLButtonElement;

    btn.onclick = async () => {
        const url = browser.runtime.getURL("html/cdp_auth.html");
        await browser.tabs.create({ url });
    };

    const statusEl = $Id("cdp-auth-status") as HTMLElement;
    const user = await tryGetSignedInUser();

    if (!user || !user.evmAccounts?.length) {
        statusEl.innerText = "未连接";
        return;
    }

    const address = user.evmAccounts[0];
    statusEl.innerText = `已连接：${address.slice(0, 6)}...${address.slice(-4)}`;
}

const CDP_PROJECT_ID = "602a8505-5645-45e5-81aa-a0a642ed9a0d"; // 你的 Project ID

let inited = false;

export async function initCdpOnce() {
    if (inited) return;

    const config: Config = {
        projectId: CDP_PROJECT_ID,
        ethereum: {
            createOnLogin: "smart", // 推荐 smart account
        },
    };

    await initialize(config);
    inited = true;
}

export async function tryGetSignedInUser() {
    await initCdpOnce();
    try {
        return await getCurrentUser();
    } catch {
        return null;
    }
}

export async function doSignOut() {
    await initCdpOnce();
    await signOut();
}