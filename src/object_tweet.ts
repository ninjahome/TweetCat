export class TweetCardImage {
    url: string;
    width: number;
    height: number;

    constructor(value: any) {
        this.url = value?.url || '';
        this.width = value?.width || 0;
        this.height = value?.height || 0;
    }
}

export class TweetCardColor {
    r: number;
    g: number;
    b: number;
    percentage: number;

    constructor(rgb: any, percentage: number) {
        this.r = rgb?.red || 0;
        this.g = rgb?.green || 0;
        this.b = rgb?.blue || 0;
        this.percentage = percentage || 0;
    }
}

export class TweetCard {
    restId: string;
    name: string;
    url: string;
    title?: string;
    description?: string;
    domain?: string;
    vanityUrl?: string;
    images: TweetCardImage[] = [];
    mainImageUrl?: string;
    thumbnailColorPalette: TweetCardColor[] = [];

    constructor(data: any) {
        this.restId = data.rest_id || '';
        this.name = data.legacy?.name || '';
        this.url = data.legacy?.url || '';

        const bindingValues = data.legacy?.binding_values || [];

        for (const value of bindingValues) {
            const key = value.key;
            const v = value.value;

            switch (key) {
                case 'title':
                    this.title = v?.string_value;
                    break;
                case 'description':
                    this.description = v?.string_value;
                    break;
                case 'card_url':
                    this.url = v?.string_value || this.url;
                    break;
                case 'domain':
                    this.domain = v?.string_value;
                    break;
                case 'vanity_url':
                    this.vanityUrl = v?.string_value;
                    break;

                case 'thumbnail_image':
                case 'thumbnail_image_small':
                case 'thumbnail_image_large':
                case 'thumbnail_image_x_large':
                case 'thumbnail_image_original':
                case 'photo_image_full_size':
                case 'photo_image_full_size_small':
                case 'photo_image_full_size_large':
                case 'photo_image_full_size_x_large':
                case 'photo_image_full_size_original':
                case 'summary_photo_image':
                case 'summary_photo_image_small':
                case 'summary_photo_image_large':
                case 'summary_photo_image_x_large':
                case 'summary_photo_image_original':
                    const img = v?.image_value;
                    if (img) {
                        this.images.push(new TweetCardImage(img));
                        if (!this.mainImageUrl) {
                            this.mainImageUrl = img.url;
                        }
                    }
                    break;

                case 'thumbnail_image_color':
                case 'photo_image_full_size_color':
                case 'summary_photo_image_color':
                    const colorPalette = v?.image_color_value?.palette || [];
                    for (const palette of colorPalette) {
                        this.thumbnailColorPalette.push(new TweetCardColor(palette.rgb, palette.percentage));
                    }
                    break;
            }
        }
    }
}


// 单个媒体对象
export class TweetMediaEntity {
    display_url: string;
    expanded_url: string;
    id_str: string;
    media_key: string;
    media_url_https: string;
    type: string;
    url: string;

    constructor(data: any) {
        this.display_url = data.display_url;
        this.expanded_url = data.expanded_url;
        this.id_str = data.id_str;
        this.media_key = data.media_key;
        this.media_url_https = data.media_url_https;
        this.type = data.type;
        this.url = data.url;
    }
}

// 单个链接对象
export class UrlEntity {
    display_url: string;
    expanded_url: string;
    url: string;
    indices: [number, number];

    constructor(data: any) {
        this.display_url = data.display_url;
        this.expanded_url = data.expanded_url;
        this.url = data.url;
        this.indices = data.indices;
    }
}

// 单个用户提及对象
export class UserMentionEntity {
    screen_name: string;
    name: string;
    id_str: string;
    indices: [number, number];

    constructor(data: any) {
        this.screen_name = data.screen_name;
        this.name = data.name;
        this.id_str = data.id_str;
        this.indices = data.indices;
    }
}

// 单个话题标签对象
export class HashtagEntity {
    text: string;
    indices: [number, number];

    constructor(data: any) {
        this.text = data.text;
        this.indices = data.indices;
    }
}

// Tweet 中 entities 部分
export class TweetEntity {
    hashtags: HashtagEntity[];
    symbols: any[];
    user_mentions: UserMentionEntity[];
    urls: UrlEntity[];
    media: TweetMediaEntity[];

    constructor(data: any) {
        this.hashtags = (data?.hashtags || []).map((h: any) => new HashtagEntity(h));
        this.symbols = data?.symbols || [];
        this.user_mentions = (data?.user_mentions || []).map((u: any) => new UserMentionEntity(u));
        this.urls = (data?.urls || []).map((u: any) => new UrlEntity(u));
        this.media = (data?.media || []).map((m: any) => new TweetMediaEntity(m));
    }
}

// Tweet 中 extended_entities 部分
export class TweetExtendedEntity {
    media: TweetMediaEntity[];

    constructor(data: any) {
        this.media = (data?.media || []).map((m: any) => new TweetMediaEntity(m));
    }
}


/*
*
* 字段 | 示例 | 说明 | 用于构造
full_text | "...the Trump administration’s stance on Taiwan..." | ✅ 推文完整正文 | fullText / text
created_at | "Mon Apr 14 10:30:45 +0000 2025" | ✅ 发布时间（GMT） | createdAt
favorite_count | 2 | ✅ 点赞数 | tweetLikes
retweet_count | 2 | ✅ 转发数 | tweetRetweets
reply_count | 0 | ✅ 回复数 | tweetReplies
bookmark_count | 2 | ✅ 收藏数 | tweetBookmarks
lang | "en" | 推文语言 | lang
entities | { hashtags, urls, user_mentions, symbols } | 包含链接/话题 | 高亮 / 链接处理时用
extended_entities | { media: [ ... ] } | ✅ 多媒体内容，如图片/视频 | mediaEntities[]
possibly_sensitive | false | 内容是否敏感 | 安全提示、遮罩
conversation_id_str | tweet id | 会话线程 ID | 可能用于加载上下文推文
id_str | tweet id | ✅ 当前推文 ID（冗余） | id
*
*
* 字段 | 用途 | 是否重要
extended_entities.media[] | 包含媒体链接（图/视频） | ✅ 构造 TweetMedia
entities.urls[] | 如果含卡片，常在这里有短链 URL | ✅ 用于 cardUrl 反查
card（不在 legacy 内） | 富媒体链接（例如文章预览） | ✅ 单独字段，不在 legacy，但需要结合 entities.urls 使用
*
*
* 字段 | 说明 | 可能用途
source | 来源客户端，如 Twitter Web App | 渲染推文来源文字
is_quote_status | 是否是引用推文 | 加载引用推文
quoted_status_id_str | 被引用的推文 ID | 可用于嵌套展示
truncated | false | 旧接口遗留，基本总是 false
display_text_range | [start, end] | 高亮处理（如 emoji）时可参考
* */
export class TweetContent {
    bookmark_count: number;
    bookmarked: boolean;
    created_at: string;
    conversation_id_str: string;
    display_text_range: [number, number];
    entities: TweetEntity;
    extended_entities: TweetExtendedEntity;
    favorite_count: number
    favorited: boolean;
    full_text: string;
    is_quote_status: boolean;
    lang: string;
    quote_count: number;
    reply_count: number;
    retweet_count: number;
    retweeted: boolean;
    id_str: string;
    user_id_str: string;

    constructor(data: any) {
        this.bookmark_count = data.bookmark_count;
        this.bookmarked = data.bookmarked;
        this.created_at = data.created_at;
        this.conversation_id_str = data.conversation_id_str;
        this.display_text_range = data.display_text_range as [number, number];
        this.entities = new TweetEntity(data.entities);
        this.extended_entities = new TweetExtendedEntity(data.extended_entities);
        this.favorite_count = data.favorite_count;
        this.favorited = data.favorited;
        this.full_text = data.full_text;
        this.is_quote_status = data.is_quote_status;
        this.lang = data.lang;
        this.reply_count = data.reply_count;
        this.retweet_count = data.retweet_count;
        this.quote_count = data.quote_count;
        this.retweeted = data.retweeted;
        this.id_str = data.id_str;
        this.user_id_str = data.user_id_str;
    }
}

/*
*
* 字段 | 示例值 | 含义 | 你用在哪里
name | "ThinkChina" | 显示名称 | ✅ displayName
screen_name | "ThinkChinaSG" | 用户名（@xxx） | ✅ screenName
description | 文本 + 链接 | 用户简介 | ✅ description
location | "Singapore" | 所在地 | ✅ location
followers_count | 13347 | 粉丝数量 | ✅ followersCount
profile_image_url_https | URL | 头像地址 | ✅ avatarUrl
url | 个人主页链接 | 展示网址 | 可选（非核心）
verified | false | 是否为 legacy verified 用户 | ✅（和 is_blue_verified 合并处理）
created_at | 时间戳 | 用户注册时间 | ⛔ 不用展示时可略过
statuses_count | 4023 | 总发推数 | 可选
pinned_tweet_ids_str | ["..."] | 置顶推文 ID | 可选（不用于显示）
*
*
* 字段 | 含义 | 忽略理由
can_dm, can_media_tag | 私信 / 媒体标签权限 | UI 不展示
default_profile, default_profile_image | 是否为默认头像 | 可用于显示“未设置头像”
want_retweets | 是否允许被转发 | 较少用
withheld_in_countries | 屏蔽国家列表 | 特殊内容屏蔽，不常用
listed_count, favourites_count, friends_count | 列表 / 点赞 / 关注数 | UI 不常展示
* */
export class AuthorLegacy {
    displayName: string;
    screenName: string;
    profile_banner_url: string;
    profile_image_url_https: string;
    verified: boolean;
    fast_followers_count: number;
    favourites_count: number;
    followers_count: number;
    friends_count: number;
    listed_count: number;
    media_count: number;
    normal_followers_count: number;
    statuses_count: number;

    constructor(data: any) {
        this.displayName = data.name;
        this.screenName = data.screen_name;
        this.profile_banner_url = data.profile_banner_url;
        this.profile_image_url_https = data.profile_image_url_https;
        this.verified = data.verified;

        this.fast_followers_count = data.fast_followers_count;
        this.favourites_count = data.favourites_count;
        this.followers_count = data.followers_count;
        this.friends_count = data.friends_count;
        this.listed_count = data.listed_count;
        this.media_count = data.media_count;
        this.normal_followers_count = data.normal_followers_count;
        this.statuses_count = data.statuses_count;
    }
}

/*
* 字段 | 说明 | 你是否需要
__typename | GraphQL 类型名，值为 "User" | ❌
id | Base64 编码的 GraphQL 全局 ID（如 Apollo 用） | ❌
rest_id | Twitter 用户 ID（字符串数字） | ✅ 必须，构造用户标识（userId）
*
* 字段 | 示例值 | 含义 | 是否建议保留
is_blue_verified | true | 是否为 Twitter Blue 认证用户（带蓝勾） | ✅
profile_image_shape | "Circle" | 头像样式（目前几乎总是 Circle） | ❌ 一般用于样式而非数据
has_graduated_access | true | 内部标识（可能和 API 权限相关） | ❌
* */
export class TweetAuthor {
    authorID: string;
    is_blue_verified: boolean;
    legacy: AuthorLegacy;
    professional: any

    constructor(data: any) {
        this.authorID = data.rest_id;
        this.is_blue_verified = data.is_blue_verified;
        this.legacy = new AuthorLegacy(data.legacy);
        this.professional = data.professional;
    }
}

/*
* 字段路径 | 是否重要 | 说明
tweet_results.result.rest_id | ✅ 必须 | 推文 ID
tweet_results.result.legacy | ✅ 必须 | 正文、时间、互动数、媒体等
tweet_results.result.core.user_results | ✅ 必须 | 发推用户（构造 TweetAuthor）
tweet_results.result.card | ✅ 可选 | 卡片链接数据
tweet_results.result.views.count | ✅ 推荐 | 浏览量
tweet_results.result.__typename !== 'Tweet' | ✅ 过滤条件 | 非 Tweet 类型不应处理
* */
export class TweetObj {
    rest_id: string;//
    unmention_data: any;
    author: TweetAuthor;
    edit_control: any;
    is_translatable: boolean
    views: any;
    source: string;
    quick_promote_eligibility: any
    tweetContent: TweetContent;
    card: TweetCard;

    constructor(tweetResult: any) {
        this.rest_id = tweetResult.rest_id;
        this.unmention_data = tweetResult.unmention_data;
        this.author = new TweetAuthor(tweetResult.core.user_results.result);
        this.edit_control = tweetResult.edit_control;
        this.is_translatable = tweetResult.is_translatable;
        this.views = tweetResult.views;
        this.source = tweetResult.source;
        this.quick_promote_eligibility = tweetResult.quick_promote_eligibility;
        this.tweetContent = new TweetContent(tweetResult.legacy);
        this.card = new TweetCard(tweetResult.card);
    }
}

export class EntryObj {
    entryId: string;
    sortIndex: string;

    /*content data*/
    entryType: string;
    clientEventInfo: any;

    /*itemContent data*/
    itemType: string;
    tweetDisplayType: string;
    socialContext: any;

    tweet: TweetObj;

    constructor(entry: any) {
        console.log("-----temp-------->>> raw tweet data:\n", entry);
        this.entryId = entry.entryId;
        this.sortIndex = entry.sortIndex;

        const content = entry.content;
        this.entryType = content.entryType;
        this.clientEventInfo = content.clientEventInfo;

        const itemContent = content.itemContent;

        this.itemType = itemContent.itemType;
        this.tweetDisplayType = itemContent.tweetDisplayType;
        this.socialContext = itemContent.socialContext;

        this.tweet = new TweetObj(itemContent.tweet_results.result);
    }
}

