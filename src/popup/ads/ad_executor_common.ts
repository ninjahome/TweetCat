import { atomicToUsdcNumber, formatUSDC, formatTimeLocal } from "../common";
import {
    API_PATH_ADS_LIST,
    API_PATH_ADS_CLAIM,
    API_PATH_ADS_MY_CLAIMS,
    API_PATH_ADS_MY_TASKS
} from "./ad_publisher_common";

export type AdCategory = "follow" | "visit" | "register" | "share";

export interface EarnAd {
    id: string;
    title: string;
    brand: string;
    description: string;
    category: AdCategory;
    rewardUSDC: number;
    durationMinutes: number;
    completed: number;
    totalQuota: number;
    deadlineText: string;
    tags: string[];
    rewardRange: "0.1-0.5" | "0.5-1" | "1+";
    popularityScore: number;
    createdAt: number;
    detailUrl: string;
    brandAvatarUrl?: string;
    brandBannerUrl?: string;
    isClaimed?: boolean;
}

export interface EarnClaim {
    claim_id: string;
    ad_id: string;
    status: string;
    created_at: string;
    expires_at: string;
    unit_price_atomic: string;
    ad_title?: string;
}

export interface TaskWithAdInfo {
    claim_id: string;
    ad_id: string;
    status: string;
    created_at: string;
    ad: {
        title: string;
        brand: string;
        category: string;
        rewardUSDC: number;
        detailUrl: string;
        durationMinutes: number;
        deadlineText: string;
        brandAvatarUrl?: string;
        brandBannerUrl?: string;
    };
}

export const executorState = {
    earnAds: [] as EarnAd[],
    myClaims: [] as EarnClaim[],
    myTasks: [] as TaskWithAdInfo[],
    myTasksTotal: 0,
    myTasksPage: 0,
    myTasksLoading: false,
    myTasksStatus: 'all' as 'all' | 'pending' | 'confirmed' | 'rejected',
    currentTab: 'explore' as 'explore' | 'my-tasks',
    withdrawableUSDC: 0,
    withdrawableAtomic: "0" as string,  // Server-side available_atomic (precise, for withdraw)
    lastWithdrawAt: null as string | null,
    totalEarnedUSDC: 0,
    todayEarnedUSDC: 0,
    pendingUSDC: 0,
    taskRunState: {} as Record<string, "idle" | "running">,
};

export const categoryIcon: Record<AdCategory, string> = {
    follow: "👤",
    visit: "🔗",
    register: "🧾",
    share: "🔁"
};

export const CATEGORY_DURATION: Record<AdCategory, number> = {
    follow: 2,
    visit: 3,
    register: 5,
    share: 4,
};

import { t } from "../../common/i18n";

export const CATEGORY_TAGS: Record<AdCategory, string[]> = {
    follow: [t("tag_new"), t("tag_easy")],
    visit: [t("tag_explore")],
    register: [t("tag_high_reward")],
    share: [t("tag_popular")],
};

export const TASK_STATUS_MAP: Record<string, string> = {
    "CLAIMED": t("status_claimed_todo"),
    "PENDING_CONFIRM": t("status_pending_verification"),
    "CONFIRMED": t("status_settled_paid"),
    "REJECTED": t("status_rejected")
};

export function getRewardRange(rewardUSDC: number): "0.1-0.5" | "0.5-1" | "1+" {
    if (rewardUSDC < 0.5) return "0.1-0.5";
    if (rewardUSDC < 1) return "0.5-1";
    return "1+";
}

export function formatClaimTime(value?: string | number): string {
    return formatTimeLocal(value);
}
import browser from "webextension-polyfill";

export async function saveTaskRunState() {
    await browser.storage.local.set({ adTaskRunState: executorState.taskRunState });
}

export async function loadTaskRunState() {
    const data = await browser.storage.local.get("adTaskRunState");
    if (data.adTaskRunState) {
        executorState.taskRunState = data.adTaskRunState;
    }
}
