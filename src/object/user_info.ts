import {differenceInYears, parse} from 'date-fns';

// === 1. 核心用户信息接口 ===
export interface IUserCore {
    userName: string;        // @screen_name, e.g., "elonmusk"
    displayName: string;     // name, e.g., "Elon Musk"
    userId: string;          // rest_id (数字ID), e.g., "44196397"
    internalId: string;      // Base64 id, e.g., "VXNlcjo0NDE5NjM5Nw=="
    createdAt: string;       // ISO string, e.g., "2009-06-02T20:12:29.000Z"
}

// === 2. 规模影响力字段 ===
export interface IScaleMetrics {
    followersCount: number;
    friendsCount: number;
    listedCount: number;
    followerRatio: number;   // followers / friends
}

// === 3. 活跃与内容力字段 ===
export interface IActivityMetrics {
    statusesCount: number;
    favouritesCount: number;
    mediaCount: number;
    creatorSubscriptionsCount: number;
    avgTweetsPerDay: number; // 计算得出
}

// === 4. 平台信任与权限字段 ===
export interface ITrustMetrics {
    isBlueVerified: boolean;
    canHighlightTweets: boolean;
    hasAffiliateLabel: boolean;
    isSuperFollowEligible: boolean;
}

// === 5. 品牌与专业化字段 ===
export interface IBrandMetrics {
    hasProfileBanner: boolean;
    hasProfessionalType: boolean;
    hasHiddenSubscriptions: boolean;
    hasDescription: boolean;
}

// === 6. 成长与稀有性字段 ===
export interface IGrowthMetrics {
    accountAgeYears: number;
}

// === 7. 主结构体：包含所有打分字段 ===
export interface IUserScoreData
    extends IUserCore,
        IScaleMetrics,
        IActivityMetrics,
        ITrustMetrics,
        IBrandMetrics,
        IGrowthMetrics {
}

// === 8. 可实例化的类（推荐使用）===
export class UserScoreProfile implements IUserScoreData {
    // 基础信息
    userName: string;
    displayName: string;
    userId: string;
    internalId: string;
    createdAt: string;

    // 规模
    followersCount: number = 0;
    friendsCount: number = 0;
    listedCount: number = 0;
    followerRatio: number = 0;

    // 活跃
    statusesCount: number = 0;
    favouritesCount: number = 0;
    mediaCount: number = 0;
    creatorSubscriptionsCount: number = 0;
    avgTweetsPerDay: number = 0;

    // 信任
    isBlueVerified: boolean = false;
    canHighlightTweets: boolean = false;
    hasAffiliateLabel: boolean = false;
    isSuperFollowEligible: boolean = false;

    // 品牌
    hasProfileBanner: boolean = false;
    hasProfessionalType: boolean = false;
    hasHiddenSubscriptions: boolean = false;
    hasDescription: boolean = false;

    // 成长
    accountAgeYears: number = 0;

    constructor(rawData: any) {
        this.fillFromApi(rawData);
    }

    // === 从 Twitter API JSON 填充数据 ===
    private fillFromApi(data: any) {
        const user = data?.data?.user?.result;
        if (!user) throw new Error("Invalid Twitter API response");

        // 1. 核心信息
        this.userName = user.core?.screen_name ?? "";
        this.displayName = user.core?.name ?? "";
        this.userId = user.rest_id ?? "";
        this.internalId = user.id ?? "";
        this.createdAt = user.core?.created_at ?? "";

        // 2. 规模
        this.followersCount = user.legacy?.followers_count ?? 0;
        this.friendsCount = user.legacy?.friends_count ?? 0;
        this.listedCount = user.legacy?.listed_count ?? 0;
        this.followerRatio = this.friendsCount > 0 ? this.followersCount / this.friendsCount : 0;

        // 3. 活跃
        this.statusesCount = user.legacy?.statuses_count ?? 0;
        this.favouritesCount = user.legacy?.favourites_count ?? 0;
        this.mediaCount = user.legacy?.media_count ?? 0;
        this.creatorSubscriptionsCount = user.creator_subscriptions_count ?? 0;

        // 计算平均每日推文
        const ageDays = this.calculateAgeInDays();
        this.avgTweetsPerDay = ageDays > 0 ? this.statusesCount / ageDays : 0;

        // 4. 信任
        this.isBlueVerified = user.is_blue_verified ?? false;
        this.canHighlightTweets = user.highlights_info?.can_highlight_tweets ?? false;
        this.hasAffiliateLabel = !!user.affiliates_highlighted_label?.label;
        this.isSuperFollowEligible = user.super_follow_eligible ?? false;

        // 5. 品牌
        this.hasProfileBanner = !!user.legacy?.profile_banner_url;
        this.hasProfessionalType = !!user.professional?.professional_type;
        this.hasHiddenSubscriptions = user.has_hidden_subscriptions_on_profile ?? false;
        this.hasDescription = !!user.legacy?.description;

        // 6. 成长
        this.accountAgeYears = differenceInYears(new Date(), parse(this.createdAt, "EEE MMM dd HH:mm:ss Z yyyy", new Date()));
    }

    // === 辅助：计算账户年龄（天）===
    private calculateAgeInDays(): number {
        const created = parse(this.createdAt, "EEE MMM dd HH:mm:ss Z yyyy", new Date());
        const now = new Date();
        return Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
    }

    // === 可选：输出为 JSON（用于存储/传输）===
    toJSON(): IUserScoreData {
        return {...this};
    }
}


export async function updateUserInfo(data: any): Promise<boolean> {
    return false;
}