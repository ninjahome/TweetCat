/* ====================== 1. 接口定义 ====================== */
export interface IUserCore {
    userName: string;
    displayName: string;
    userId: string;
    internalId: string;
    createdAt: string;
    avatar: string;  // 新增：头像 URL
}

export interface IScaleMetrics {
    followersCount: number;
    friendsCount: number;
    listedCount: number;
    followerRatio: number;
}

export interface IActivityMetrics {
    statusesCount: number;
    favouritesCount: number;
    mediaCount: number;
    creatorSubscriptionsCount: number;
    avgTweetsPerDay: number;
}

export interface ITrustMetrics {
    isBlueVerified: boolean;
    canHighlightTweets: boolean;
    hasAffiliateLabel: boolean;
    isSuperFollowEligible: boolean;
}

export interface IBrandMetrics {
    hasProfileBanner: boolean;
    hasProfessionalType: boolean;
    hasHiddenSubscriptions: boolean;
    hasDescription: boolean;
}

export interface IGrowthMetrics {
    accountAgeDays: number;
}

export interface IUserScoreData
    extends IUserCore,
        IScaleMetrics,
        IActivityMetrics,
        ITrustMetrics,
        IBrandMetrics,
        IGrowthMetrics {
}

/* ====================== 2. 主类 ====================== */
export class UserProfile implements IUserScoreData {
    /* ---------- 基础信息 ---------- */
    userName: string = '';
    displayName: string = '';
    userId: string = '';
    internalId: string = '';
    createdAt: string = '';
    avatar: string = '';  // 新增字段

    /* ---------- 规模 ---------- */
    followersCount: number = 0;
    friendsCount: number = 0;
    listedCount: number = 0;
    followerRatio: number = 0;

    /* ---------- 活跃 ---------- */
    statusesCount: number = 0;
    favouritesCount: number = 0;
    mediaCount: number = 0;
    creatorSubscriptionsCount: number = 0;
    avgTweetsPerDay: number = 0;

    /* ---------- 信任 ---------- */
    isBlueVerified: boolean = false;
    canHighlightTweets: boolean = false;
    hasAffiliateLabel: boolean = false;
    isSuperFollowEligible: boolean = false;

    /* ---------- 品牌 ---------- */
    hasProfileBanner: boolean = false;
    hasProfessionalType: boolean = false;
    hasHiddenSubscriptions: boolean = false;
    hasDescription: boolean = false;

    /* ---------- 成长 ---------- */
    accountAgeDays: number = 0;

    /* ====================== 构造函数 ====================== */
    constructor(rawTwitterJson: any) {
        this.fillFromApi(rawTwitterJson);
    }

    /* ====================== 填充 API 数据 ====================== */
    private fillFromApi(data: any): void {
        const u = data?.data?.user?.result;
        if (!u) throw new Error('Invalid Twitter API payload');

        // 1. 核心 + 头像
        this.userName = u.core?.screen_name ?? '';
        this.displayName = u.core?.name ?? '';
        this.userId = u.rest_id ?? '';
        this.internalId = u.id ?? '';
        this.createdAt = u.core?.created_at ?? '';
        this.avatar = u.avatar?.image_url ?? '';  // 正确读取头像

        // 2. 规模
        this.followersCount = u.legacy?.followers_count ?? 0;
        this.friendsCount = u.legacy?.friends_count ?? 0;
        this.listedCount = u.legacy?.listed_count ?? 0;
        this.followerRatio = this.friendsCount > 0 ? this.followersCount / this.friendsCount : 0;

        // 3. 活跃
        this.statusesCount = u.legacy?.statuses_count ?? 0;
        this.favouritesCount = u.legacy?.favourites_count ?? 0;
        this.mediaCount = u.legacy?.media_count ?? 0;
        this.creatorSubscriptionsCount = u.creator_subscriptions_count ?? 0;

        // 4. 信任
        this.isBlueVerified = !!u.is_blue_verified;
        this.canHighlightTweets = !!u.highlights_info?.can_highlight_tweets;
        this.hasAffiliateLabel = !!u.affiliates_highlighted_label?.label;
        this.isSuperFollowEligible = !!u.super_follow_eligible;

        // 5. 品牌
        this.hasProfileBanner = !!u.legacy?.profile_banner_url;
        this.hasProfessionalType = !!u.professional?.professional_type;
        this.hasHiddenSubscriptions = !!u.has_hidden_subscriptions_on_profile;
        this.hasDescription = !!u.legacy?.description?.trim();

        // 6. 成长
        this.accountAgeDays = this.calculateAgeInDays();
        this.avgTweetsPerDay = this.statusesCount / Math.max(this.accountAgeDays, 1);

    }

    private calculateAgeInDays(): number {
        const created = new Date(this.createdAt);
        if (isNaN(created.getTime())) return 1; // 防崩溃
        const now = new Date();
        return Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
    }


    /* ====================== 辅助 ====================== */
    public toJSON(): IUserScoreData {
        return {...this};
    }
}

/* ====================== 评分常量（可调） ====================== */
// 各分项权重 / Weights
const W = {
    scale: {followers: 30, ratio: 8, listed: 12},                 // =50
    activity: {statuses: 8, favourites: 6, media: 6, creator: 5},    // =25
    trust: {blue: 8, highlight: 8, affiliate: 9},                 // =25
    brand: {banner: 3, pro: 4, hidden: 4, desc: 4},               // =15
    growth: 5,                                                       // =5
} as const;

// 规模项归一化参考 / Normalization caps
const CAPS = {
    followersBase: 100,         // 粉丝数先除以此基数再取 log
    listedMaxRef: 165805,      // 参考最大 listedCount（可按样本定期更新）
    statuses: 100_000,
    favourites: 200_000,
    media: 5_000,
    creator: 300,
} as const;

export const MAX_DAYS_FOR_GROWTH = 16 * 365; // 成长封顶天数（16 年）

// 全局难度曲线（“越往后越难”）/ Global difficulty curve
const RAW_MAX = 120;           // 理论总上限：50+25+25+15+5=120
const DIFFICULTY_BETA = 0.90;  // (0,1) 越小后期越难
const ANCHOR_T = 0.92;         // 锚点（例如“马斯克≈92”）

/* ====================== 工具函数 / Utils ====================== */
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const nz = (x: number) => (Number.isFinite(x) ? x : 0);
// log10(1+x)：对小号更友好、对大号边际递减
const log10p = (x: number) => Math.log10(Math.max(0, x) + 1);
// 以参考最大值做对数归一（0..1）
const normLogTo = (x: number, refMax: number) =>
    refMax > 0 ? clamp01(log10p(nz(x)) / log10p(refMax)) : 0;

// 难度曲线：后期更难且在 t=ANCHOR_T 处锚定 / Difficulty with anchor
function applyDifficulty(totalRaw: number): number {
    const t = clamp01(totalRaw / RAW_MAX); // 0..1
    const level = 100 * Math.pow(t, DIFFICULTY_BETA) * Math.pow(ANCHOR_T, 1 - DIFFICULTY_BETA);
    return Math.max(0, Math.min(100, Number(level.toFixed(2))));
}

/* ====================== 分项结构 / Breakdown ====================== */
export interface LevelScoreBreakdown {
    scale: number;     // 规模分 / Scale — 粉丝、关注比、被列入列表
    activity: number;  // 活跃分 / Activity — 发推、点赞、媒体、创作者订阅
    trust: number;     // 信任分 / Trust — 蓝标、高亮、附属标签
    brand: number;     // 品牌分 / Brand — Banner、专业账号、隐藏订阅、简介
    growth: number;    // 成长分 / Growth — 账号年龄
    total: number;     // 总分 / Total — 施加难度曲线后的最终 100 分
}

/* ====================== 评分主函数 / Scoring ====================== */
export function calculateLevelBreakdown(user: UserProfile): LevelScoreBreakdown {
    // —— 1) 规模 / Scale（对数软上限，抗极值） ——
    const scale_followers =
        Math.min(10 * log10p(nz(user.followersCount) / CAPS.followersBase), W.scale.followers);
    // 关注比：对数平滑（负值截断为 0）
    const scale_ratio = W.scale.ratio * clamp01(log10p(Math.max(0, nz(user.followerRatio))));
    // 被列入列表：相对参考最大值做 log 归一
    const scale_listed = W.scale.listed * normLogTo(nz(user.listedCount), CAPS.listedMaxRef);
    const scale = scale_followers + scale_ratio + scale_listed;

    // —— 2) 活跃 / Activity（线性归一 + 封顶，简单稳健） ——
    const activity =
        W.activity.statuses * clamp01(nz(user.statusesCount) / CAPS.statuses) +
        W.activity.favourites * clamp01(nz(user.favouritesCount) / CAPS.favourites) +
        W.activity.media * clamp01(nz(user.mediaCount) / CAPS.media) +
        W.activity.creator * clamp01(nz(user.creatorSubscriptionsCount) / CAPS.creator);

    // —— 3) 信任 / Trust（布尔加权） ——
    const trust =
        (user.isBlueVerified ? W.trust.blue : 0) +
        (user.canHighlightTweets ? W.trust.highlight : 0) +
        (user.hasAffiliateLabel ? W.trust.affiliate : 0);

    // —— 4) 品牌 / Brand（布尔加权） ——
    const brand =
        (user.hasProfileBanner ? W.brand.banner : 0) +
        (user.hasProfessionalType ? W.brand.pro : 0) +
        (user.hasHiddenSubscriptions ? W.brand.hidden : 0) +
        (user.hasDescription ? W.brand.desc : 0);

    // —— 5) 成长 / Growth（与账号年龄线性，封顶） ——
    const growth = W.growth * clamp01(nz(user.accountAgeDays) / MAX_DAYS_FOR_GROWTH);

    // —— 6) 总分：施加“后期更难”的难度曲线 / Total with difficulty ——
    const totalRaw = scale + activity + trust + brand + growth; // 0..≈120
    const total = applyDifficulty(totalRaw);                    // 0..100

    return {scale, activity, trust, brand, growth, total};
}

// 便捷封装：仅要总分时调用 / Shortcut
export function calculateLevel(user: Parameters<typeof calculateLevelBreakdown>[0]): number {
    return calculateLevelBreakdown(user).total;
}
