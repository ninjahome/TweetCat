import { $Id, showNotification, openTxInExplorer, openAddrInExplorer } from "../common";
import { ChainNameBaseMain, walletInfo, X402_FACILITATORS } from "../../common/x402_obj";
import { getChainId } from "../../wallet/wallet_setting";
import { queryCdpWalletInfo, x402WorkerFetch, x402WorkerGet } from "../../wallet/cdp_wallet";

export type AdStatus = 'ACTIVE' | 'PAUSED_NO_BUDGET' | 'PAUSED_MANUAL' | 'EXPIRED' | 'COMPLETED';

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
    quota_claimed?: number;
    quota_used: number;
    status: AdStatus;
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

export interface ClaimantRecord {
    b_x_id: string;
    username: string;
    amount_atomic: string;
    created_at: string;
    status: string;
}

// API Paths (Matching tweetcat-x402-worker common.ts)
import {
    API_PATH_ADS_LIST,
    API_PATH_ADS_CLAIM,
    API_PATH_ADS_MY_CLAIMS,
    API_PATH_ADS_CREATE,
    API_PATH_ADS_UPDATE,
    API_PATH_ADS_MY_ADS,
    API_PATH_ADS_PUBLISHER_RECHARGE,
    API_PATH_ADS_PUBLISHER_WITHDRAW,
    API_PATH_ADS_PUBLISHER_LEDGER,
    API_PATH_ADS_TOGGLE_STATUS,
    API_PATH_ADS_TOP_UP_BUDGET,
    API_PATH_ADS_PUBLISHER_DASHBOARD_INFO,
    API_PATH_ADS_PUBLISHER_SPEND_HISTORY,
    API_PATH_ADS_PUBLISHER_AD_CLAIMS,
    API_PATH_ADS_EXECUTOR_DASHBOARD_INFO,
    API_PATH_ADS_EXECUTOR_WITHDRAW
} from "../../common/api_paths";

export {
    API_PATH_ADS_LIST,
    API_PATH_ADS_CLAIM,
    API_PATH_ADS_MY_CLAIMS,
    API_PATH_ADS_CREATE,
    API_PATH_ADS_UPDATE,
    API_PATH_ADS_MY_ADS,
    API_PATH_ADS_PUBLISHER_RECHARGE,
    API_PATH_ADS_PUBLISHER_WITHDRAW,
    API_PATH_ADS_PUBLISHER_LEDGER,
    API_PATH_ADS_TOGGLE_STATUS,
    API_PATH_ADS_TOP_UP_BUDGET,
    API_PATH_ADS_PUBLISHER_DASHBOARD_INFO,
    API_PATH_ADS_PUBLISHER_SPEND_HISTORY,
    API_PATH_ADS_PUBLISHER_AD_CLAIMS,
    API_PATH_ADS_EXECUTOR_DASHBOARD_INFO,
    API_PATH_ADS_EXECUTOR_WITHDRAW
};

export const API_PATH_ADS_MY_TASKS = "/ads/executor/my_tasks";

// ========= Dashboard Info 相关类型定义 =========
export interface DashboardInfo {
    balance_atomic: string;
    frozen_atomic: string;
    active_campaigns_count: number;
    today_spend_atomic: string;
    week_spend_atomic: string;
    last_withdraw_at?: string | null;
}
export interface PaginatedModule<T> {
    list: T[];
    currentPage: number;
    pageSize: number;
    totalCount: number;
    isLoading?: boolean;
}

// ========= 共享状态（原来那些 let 全搬到这里） =========
export const publisherState = {
    adsChainId: 0,
    dashboardInfo: {
        balance_atomic: "0",
        frozen_atomic: "0",
        active_campaigns_count: 0,
        today_spend_atomic: "0",
        week_spend_atomic: "0",
        last_withdraw_at: null
    } as DashboardInfo,

    // 我的广告模块
    ads: {
        list: [] as AdRecord[],
        currentPage: 1,
        pageSize: 10,
        totalCount: 0,
        isLoading: false
    } as PaginatedModule<AdRecord>,

    // 消费记录模块
    spend: {
        list: [] as SpendRecord[],
        currentPage: 1,
        pageSize: 10,
        totalCount: 0,
        isLoading: false
    } as PaginatedModule<SpendRecord>,

    historyRecharge: [] as HistoryRow[],
    walletInfoCache: null as walletInfo | null,
};

let walletInfoInitPromise: Promise<void> | null = null;

export async function initAdsNetworkContext(): Promise<number> {
    if (publisherState.adsChainId) return publisherState.adsChainId;
    publisherState.adsChainId = await getChainId();
    return publisherState.adsChainId;
}

export function resetAdsNetworkContext(): void {
    publisherState.adsChainId = 0;
    publisherState.walletInfoCache = null;
    walletInfoInitPromise = null;
}

export async function getAdsChainId(): Promise<number> {
    return initAdsNetworkContext();
}

export async function adsWorkerGet(path: string, params?: Record<string, string>): Promise<any> {
    const chainId = await getAdsChainId();
    return x402WorkerGet(path, params, chainId);
}

export async function adsWorkerFetch(path: string, body: any, userIdOverride?: string | null): Promise<any> {
    const chainId = await getAdsChainId();
    return x402WorkerFetch(path, body, userIdOverride, chainId);
}

// ========= Wallet / Header =========

/**
 * 初始化钱包信息并更新 UI
 * @throws 如果用户未登录
 */
export async function initWalletInfo(force: boolean = false): Promise<void> {
    if (!force && publisherState.walletInfoCache?.hasCreated && publisherState.walletInfoCache?.xId) {
        updateHeaderInfo();
        updateTwitterAvatar();
        return;
    }

    if (force) {
        walletInfoInitPromise = null;
        publisherState.walletInfoCache = null;
    }

    if (!walletInfoInitPromise) {
        walletInfoInitPromise = (async () => {
            const chainId = await initAdsNetworkContext();
            publisherState.walletInfoCache = await queryCdpWalletInfo(chainId);

            if (!publisherState.walletInfoCache.hasCreated) {
                throw new Error("Please sign in and create wallet first");
            }
            if (!publisherState.walletInfoCache.xId) {
                throw new Error("X account not connected. Please sign in with X");
            }

            updateHeaderInfo();
            updateTwitterAvatar();
        })().finally(() => {
            walletInfoInitPromise = null;
        });
    }

    await walletInfoInitPromise;
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

// Re-export from common.ts for backward compatibility
export { openTxInExplorer, openAddrInExplorer };

// ========= API helpers =========
export async function fetchAdEscrowLedger(aXId: string, limit: number = 50, offset: number = 0): Promise<any[]> {
    const data = await adsWorkerGet(API_PATH_ADS_PUBLISHER_LEDGER, {
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
