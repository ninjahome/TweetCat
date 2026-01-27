import { $Id, showNotification } from "../common";
import { ChainNameBaseMain, walletInfo, X402_FACILITATORS } from "../../common/x402_obj";
import { getChainId } from "../../wallet/wallet_setting";
import { queryCdpWalletInfo, x402WorkerGet } from "../../wallet/cdp_wallet";

export type AdStatus = "Active" | "Paused" | "Paused (No Budget)" | "Ended";

export type AdStatusBackend = 'ACTIVE' | 'PAUSED_NO_BUDGET' | 'PAUSED_MANUAL' | 'EXPIRED' | 'COMPLETED';

export interface AdAccountInfo {
    balanceAtomic: string;
    frozenAtomic: string; // frozen
}

export interface AdRecord {
    ad_id: string;
    a_x_id: string;
    category: string;
    name: string;
    title: string;
    description: string;
    detail_url: string;
    image_url?: string | null;
    callback_url?: string | null;
    custom_data?: string | null;
    unit_price_atomic: string;
    quota_total: number;
    quota_used: number;
    status: AdStatusBackend;
    end_date: string; // Changed from duration_days
    created_at: string;
    updated_at?: string | null;
}

export interface SpendRecord {
    id: string;
    time: string;
    adName: string;
    event: string;
    amount: number;
    fee: number;
    status: string;
}

export interface HistoryRow {
    time: string;
    adNameOrMethod: string;
    amount: number;
    status: string;
    txHash?: string | null;
}

// API Paths (Matching tweetcat-x402-worker common.ts)
export const API_PATH_ADS_LIST = "/ads/executor/list";
export const API_PATH_ADS_CLAIM = "/ads/executor/claim";
export const API_PATH_ADS_MY_CLAIMS = "/ads/executor/my_claims";
export const API_PATH_ADS_CREATE = "/ads/publisher/create";
export const API_PATH_ADS_UPDATE = "/ads/publisher/update";
export const API_PATH_ADS_MY_ADS = "/ads/publisher/my_ads";
export const API_PATH_ADS_PUBLISHER_RECHARGE = "/ads/publisher/recharge";
export const API_PATH_ADS_PUBLISHER_WITHDRAW = "/ads/publisher/withdraw";
export const API_PATH_ADS_PUBLISHER_LEDGER = "/ads/publisher/ledger";
export const API_PATH_ADS_TOGGLE_STATUS = "/ads/publisher/toggle_status";
export const API_PATH_ADS_TOP_UP_BUDGET = "/ads/publisher/top_up_budget";
export const API_PATH_ADS_PUBLISHER_DASHBOARD_INFO = "/ads/publisher/dashboard_info";
export const API_PATH_ADS_PUBLISHER_SPEND_HISTORY = "/ads/publisher/spend_history";

// ========= Dashboard Info 相关类型定义 =========
export interface DashboardInfo {
    balance_atomic: string;
    frozen_atomic: string;
    active_campaigns_count: number;
    today_spend_atomic: string;
    week_spend_atomic: string;
}
// 模块化的分页数据结构 (扁平化方案)
export interface PaginatedModule<T> {
    list: T[];
    currentPage: number;
    pageSize: number;
    totalCount: number;
}

// ========= 共享状态（原来那些 let 全搬到这里） =========
export const publisherState = {
    dashboardInfo: {
        balance_atomic: "0",
        frozen_atomic: "0",
        active_campaigns_count: 0,
        today_spend_atomic: "0",
        week_spend_atomic: "0"
    } as DashboardInfo,

    // 我的广告模块
    ads: {
        list: [] as AdRecord[],
        currentPage: 1,
        pageSize: 10,
        totalCount: 0
    } as PaginatedModule<AdRecord>,

    // 消费记录模块
    spend: {
        list: [] as SpendRecord[],
        currentPage: 1,
        pageSize: 10,
        totalCount: 0
    } as PaginatedModule<SpendRecord>,

    historyRecharge: [] as HistoryRow[],
    walletInfoCache: null as walletInfo | null,
};

// ========= Wallet / Header =========

/**
 * 初始化钱包信息并更新 UI
 * @throws 如果用户未登录
 */
export async function initWalletInfo(): Promise<void> {
    const chainId = await getChainId();
    publisherState.walletInfoCache = await queryCdpWalletInfo(chainId);

    if (!publisherState.walletInfoCache.hasCreated) {
        throw new Error("Please sign in and create wallet first");
    }
    if (!publisherState.walletInfoCache.xId) {
        throw new Error("X account not connected. Please sign in with X");
    }

    updateHeaderInfo();
    updateTwitterAvatar();
}

/**
 * 更新头部的网络和地址显示
 */
export function updateHeaderInfo(): void {
    const w = publisherState.walletInfoCache;
    if (!w) return;

    const networkEl = $Id("header-network");
    const accountEl = $Id("header-account");
    const balanceEl = $Id("balance-value");

    if (networkEl) {
        const cfg = X402_FACILITATORS[w.chainId];
        networkEl.textContent = cfg.network || ChainNameBaseMain;
    }

    if (accountEl && w.address) {
        const addr = w.address;
        accountEl.textContent = `${addr.slice(0, 6)}...${addr.slice(-4)}`;
        accountEl.title = addr;
        accountEl.style.cursor = "pointer";
        accountEl.addEventListener("click", async () => {
            await navigator.clipboard.writeText(addr);
            showNotification("Copy Success", "success");
        });
    }

    if (balanceEl) {
        balanceEl.textContent = w.usdcVal;
    }
}

/**
 * 更新推特头像
 */
export function updateTwitterAvatar(): void {
    const w = publisherState.walletInfoCache;
    if (!w?.username) return;

    const avatarImg = document.querySelector<HTMLImageElement>("#twitter-avatar");
    const userNameEl = document.querySelector<HTMLElement>("#twitter-user-name");

    if (avatarImg) {
        avatarImg.src = `https://unavatar.io/twitter/${w.username}`;
        avatarImg.onerror = () => {
            avatarImg.src =
                "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ccircle cx='50' cy='50' r='50' fill='%23e5e7eb'/%3E%3Ctext x='50' y='65' text-anchor='middle' fill='%239ca3af' font-size='40' font-family='sans-serif'%3E👤%3C/text%3E%3C/svg%3E";
        };
    }

    if (userNameEl) {
        userNameEl.textContent = w.username;
    }
}

/**
 * 获取当前用户的 X ID
 */
export function getCurrentXId(): string {
    const w = publisherState.walletInfoCache;
    if (!w?.xId) throw new Error("X ID not available");
    return w.xId;
}

export function getCurrentXUserName(): string {
    const w = publisherState.walletInfoCache;
    if (!w?.username) throw new Error("X ID not available");
    return w.username;
}


export function isZeroAtomic(v: string | null | undefined): boolean {
    try {
        return BigInt((v ?? "0").toString()) === 0n;
    } catch {
        return true;
    }
}

export function openTxInExplorer(txHash: string): void {
    const networkLabel = ($Id("header-network")?.textContent || "").toLowerCase();
    const isSepolia = networkLabel.includes("sepolia");
    const baseUrl = isSepolia ? "https://sepolia.basescan.org/tx/" : "https://basescan.org/tx/";
    window.open(`${baseUrl}${txHash}`, "_blank");
}

// ========= API helpers =========
export async function fetchAdEscrowLedger(aXId: string, limit: number = 50, offset: number = 0): Promise<any[]> {
    const data = await x402WorkerGet(API_PATH_ADS_PUBLISHER_LEDGER, {
        a_x_id: aXId,
        limit: limit.toString(),
        offset: offset.toString()
    });
    if (!data.success || !Array.isArray(data.rows)) {
        throw new Error(data.error || "Invalid response format");
    }
    return data.rows;
}

export function parseUsdcNumber(v: string): number {
    const cleaned = (v ?? "").replace(/[^0-9.]/g, "");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : 0;
}

export function normalizeWalletUsdcDisplay(v: string): string {
    const s = (v ?? "").trim();
    if (!s) return "0.00 USDC";
    return s.toUpperCase().includes("USDC") ? s : `${s} USDC`;
}
