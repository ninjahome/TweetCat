import { atomicToUsdcNumber, formatUSDC } from "../common";
import {
    API_PATH_ADS_LIST,
    API_PATH_ADS_CLAIM,
    API_PATH_ADS_MY_CLAIMS
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

export const executorState = {
    earnAds: [] as EarnAd[],
    myClaims: [] as EarnClaim[],
    currentTab: 'explore' as 'explore' | 'my-tasks',
    withdrawableUSDC: 0,
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

export const CATEGORY_TAGS: Record<AdCategory, string[]> = {
    follow: ["New", "Easy"],
    visit: ["Explore"],
    register: ["High Reward"],
    share: ["Popular"],
};

export function getRewardRange(rewardUSDC: number): "0.1-0.5" | "0.5-1" | "1+" {
    if (rewardUSDC < 0.5) return "0.1-0.5";
    if (rewardUSDC < 1) return "0.5-1";
    return "1+";
}

export function formatClaimTime(value?: string): string {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString();
}
