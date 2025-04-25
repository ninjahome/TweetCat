// export class TweetMedia {
//     url: string;
//     media_url_https: string;
//     alt_text?: string;
//
//     constructor(data: any) {
//         this.url = data.expanded_url || data.url || '';
//         this.media_url_https = data.media_url_https || '';
//         this.alt_text = data.ext_alt_text || '';
//     }
// }

//
// export class TweetCard {
//     title?: string;
//     description?: string;
//     image?: string;
//     url?: string;
//
//     constructor(card: any[]) {
//         this.title = TweetCard.extractValue(card, 'title');
//         this.description = TweetCard.extractValue(card, 'description');
//         this.image = TweetCard.extractImage(card, [
//             'summary_photo_image_large',
//             'summary_photo_image',
//             'photo_image_full_size_large'
//         ]);
//         this.url = TweetCard.extractValue(card, 'card_url');
//     }
//
//     private static extractValue(card: any[], key: string): string | undefined {
//         return card.find((v: any) => v.key === key)?.value?.string_value;
//     }
//
//     private static extractImage(card: any[], keys: string[]): string | undefined {
//         for (const key of keys) {
//             const imageUrl = card.find((v: any) => v.key === key)?.value?.image_value?.url;
//             if (imageUrl) return imageUrl;
//         }
//         return undefined;
//     }
// }
//
// export class TweetStats {
//     tweetLikes: number;
//     tweetReplies: number;
//     tweetRetweets: number;
//     tweetBookmarks: number;
//     tweetViews: number;
//
//     constructor(legacy: any, views: any) {
//         this.tweetLikes = legacy.favorite_count;
//         this.tweetReplies = legacy.reply_count;
//         this.tweetRetweets = legacy.retweet_count;
//         this.tweetBookmarks = legacy.bookmark_count;
//         this.tweetViews = parseInt(views?.count || '0');
//     }
// }
//
// export class TweetContent {
//     id: string;
//     fullText: string;
//     text: string;
//     createdAt: string;
//     lang?: string;
//
//     constructor(legacy: any, tweet: any) {
//         this.id = legacy.id_str;
//         this.fullText = legacy.full_text;
//         this.text = tweet.full_text || '';
//         this.createdAt = legacy.created_at;
//         this.lang = tweet.lang || 'und';
//     }
// }
export class BindingValues {
    key: string
    val: any;

    constructor(data: any) {
        this.key = data.key;
        this.val = data.val;
    }
}

export class TweetCardLegacy {
    name: string;
    url: string;
    card_platform: any;
    binding_values: BindingValues[] = []

    constructor(data: any) {
        this.name = data.name;
        this.url = data.url;
        this.card_platform = data.card_platform;
        for (const m of data.binding_values) {
            this.binding_values.push(new BindingValues(m));
        }
    }
}

export class TweetResultCard {
    rest_id: string;
    legacy: TweetCardLegacy;

    constructor(data: any) {
        this.rest_id = data.rest_id;
        this.legacy = new TweetCardLegacy(data.legacy);
    }
}

export class TweetMedia {
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

export class TweetEntity {
    media: TweetMedia[] = [];

    constructor(data: any) {
        for (const m of data.media) {
            this.media.push(new TweetMedia(m));
        }
    }
}

export class TweetExtendedEntity {
    media: TweetMedia[] = [];

    constructor(data: any) {
        for (const m of data.media) {
            this.media.push(new TweetMedia(m));
        }
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
export class TweetResultLegacy {
    bookmark_count: number;
    bookmarked: boolean;
    created_at: string;
    conversation_id_str: string;
    entities: TweetEntity;
    extended_entities: TweetExtendedEntity;
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
        this.entities = new TweetEntity(data.entities);
        this.extended_entities = new TweetExtendedEntity(data.extended_entities);
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
export class TweetResult {
    rest_id: string;//
    unmention_data: any;
    author: TweetAuthor;
    edit_control: any;
    is_translatable: boolean
    views: string;
    source: string;
    quick_promote_eligibility: any
    legacy: TweetResultLegacy;
    card: TweetResultCard;

    constructor(data: any) {
        this.rest_id = data.rest_id;
        this.unmention_data = data.unmention_data;
        this.author = new TweetAuthor(data.core.user_results.result);
        this.edit_control = data.edit_control;
        this.is_translatable = data.is_translatable;
        this.views = data.views.count;
        this.source = data.source;
        this.quick_promote_eligibility = data.quick_promote_eligibility;
        this.legacy = new TweetResultLegacy(data.legacy);
        this.card = new TweetResultCard(data.card);
    }
}

export class ItemContent {
    itemType: string;
    tweetDisplayType: string;
    tweet_results: TweetResult;
    socialContext: any;

    constructor(data: any) {
        this.itemType = data.itemType;
        this.tweetDisplayType = data.tweetDisplayType;
        this.tweet_results = new TweetResult(data.tweet_results.result);
        this.socialContext = data.socialContext;
    }
}

export class ClientEventInfo {
    component: string;
    element: string;
    details: any;

    constructor(data: any) {
        this.component = data.component;
        this.element = data.element;
    }
}

export class EntryContent {
    entryType: string;
    itemContent: ItemContent;
    clientEventInfo: ClientEventInfo;

    constructor(data: any) {
        this.entryType = data.entryType;
        this.itemContent = new ItemContent(data.itemContent);
        this.clientEventInfo = new ClientEventInfo(data.clientEventInfo);
    }
}


export class TweetObj {
    entryId: string;
    sortIndex: string;
    content: EntryContent;

    constructor(entry: any) {
        console.log("-----temp-------->>> raw tweet data:\n", entry);
        this.entryId = entry.entryId;
        this.sortIndex = entry.sortIndex;
        this.content = new EntryContent(entry.content);
    }
}


export function renderTweetHTML(index: number, tweet: TweetObj, contentTemplate: HTMLTemplateElement, estimatedHeight: number = 350): HTMLElement {
    const tweetCellDiv = contentTemplate.content.getElementById("tweetCellTemplate")!.cloneNode(true) as HTMLDivElement;
    tweetCellDiv.style.transform = `translateY(${index * estimatedHeight}px)`;
    tweetCellDiv.setAttribute('id', "");

    const articleContainer = tweetCellDiv.querySelector('article[data-testid="tweet"]');
    if (!articleContainer) return tweetCellDiv;

    updateTweetAvatar(articleContainer, tweet, contentTemplate);
    const tweetBody = articleContainer.querySelector(".Tweet-Body") as HTMLElement
    updateTweetProfile(tweetBody, tweet, contentTemplate);
    updateTweetText(tweetBody, tweet, contentTemplate);
    updateTweetMedia(tweetBody, tweet, contentTemplate);
    updateTweetOperationBar(tweetBody, tweet, contentTemplate);

    return tweetCellDiv;
}


function updateTweetAvatar(container: Element, tweet: TweetObj, contentTemplate: HTMLTemplateElement): void {
    const avatarContainer = contentTemplate.content.getElementById('Tweet-User-Avatar')!.cloneNode(true) as HTMLElement;
    if (!avatarContainer) return;

    const avatarBox = avatarContainer.querySelector('[data-testid^="UserAvatar-Container-"]') as HTMLElement;
    if (avatarBox) {
        avatarBox.setAttribute('data-testid', `UserAvatar-Container-${tweet.author.screenName}`);
    }

    const avatarLink = avatarContainer.querySelector('a[href^="/"]') as HTMLAnchorElement;
    if (avatarLink) {
        avatarLink.href = `/${tweet.author.screenName}`;

        const bgDiv = avatarLink.querySelector('div[style*="background-image"]') as HTMLElement;
        if (bgDiv) {
            bgDiv.style.backgroundImage = `url(${tweet.author.avatarUrl})`;
        }

        const img = avatarLink.querySelector('img') as HTMLImageElement;
        if (img) {
            img.src = tweet.author.avatarUrl;
            img.alt = `${tweet.author.displayName} avatar`;
        }
    }

    container.querySelector(".Tweet-User-Avatar")!.appendChild(avatarContainer);
}

function updateTweetProfile(tweetBody: Element, tweet: TweetObj, contentTemplate: HTMLTemplateElement): void {
    const topButtonDiv = contentTemplate.content.getElementById('top-button-area')!.cloneNode(true) as HTMLElement;

    const userNameContainer = topButtonDiv.querySelector('[data-testid="User-Name"]') as HTMLElement;
    if (!userNameContainer) return;

    updateProfileLink(userNameContainer, tweet);
    updateUserMetaInfo(userNameContainer, tweet);

    tweetBody.append(topButtonDiv);
}

function updateProfileLink(userNameContainer: Element, tweet: TweetObj): void {
    const profileLink = userNameContainer.querySelector('a[href^="/"]') as HTMLAnchorElement;
    if (!profileLink) return;

    profileLink.href = `/${tweet.author.screenName}`;

    const displayNameSpan = profileLink.querySelector('span') as HTMLSpanElement;
    if (displayNameSpan) {
        displayNameSpan.textContent = tweet.author.displayName;
    }

    const bgDiv = profileLink.querySelector<HTMLElement>('div[style*="background-image"]');
    if (bgDiv) {
        bgDiv.style.backgroundImage = `url("${tweet.author.profileAvatarUrl}")`;
    }

    const img = profileLink.querySelector<HTMLImageElement>('img');
    if (img) {
        img.src = tweet.author.profileAvatarUrl;
        img.alt = `${tweet.author.displayName} avatar`;
    }

    const verifiedIcon = profileLink.querySelector('[data-testid="icon-verified"]')?.parentElement?.parentElement;
    if (verifiedIcon) {
        const svgContent = getVerifiedSVG(tweet.author.verifiedType ?? "");
        if (svgContent) {
            verifiedIcon.innerHTML = svgContent;
            verifiedIcon.style.display = '';
        } else {
            verifiedIcon.style.display = 'none';
        }
    }
}

function updateUserMetaInfo(userNameContainer: HTMLElement, tweet: TweetObj) {
    const userMetaBlock = userNameContainer.querySelectorAll(':scope > div')[1]; // 第二个直接子 div
    if (!userMetaBlock) return;

    // 1️⃣ @elonmusk 的链接和文字
    const atLink = userMetaBlock.querySelector('a[role="link"][tabindex="-1"]') as HTMLAnchorElement | null;
    if (atLink) {
        atLink.href = `/${tweet.author.screenName}`;
        const atSpan = atLink.querySelector('span');
        if (atSpan) {
            atSpan.textContent = `@${tweet.author.screenName}`;
        }
    }

    // 2️⃣ 推文时间链接和时间文本
    const timeLink = userMetaBlock.querySelector('a[href*="/status/"]') as HTMLAnchorElement | null;
    if (timeLink) {
        timeLink.href = `/${tweet.author.screenName}/status/${tweet.content.id}`;
        const timeTag = timeLink.querySelector('time');
        if (timeTag) {
            const isoDate = new Date(tweet.content.createdAt).toISOString();
            timeTag.setAttribute('datetime', isoDate);
            timeTag.textContent = formatTweetDate(tweet.content.createdAt); // 比如 "4月22日"
        }
    }
}

function formatTweetDate(isoString: string): string {
    const date = new Date(isoString);
    return `${date.getMonth() + 1}月${date.getDate()}日`;
}


function getVerifiedSVG(type: string): string {
    switch (type) {
        case 'blue':
            return `<g>  <path  d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.688-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.634.433 1.218.877 1.688.47.443 1.054.747 1.687.878.633.132 1.29.084 1.897-.136.274.586.705 1.084 1.246 1.439.54.354 1.17.551 1.816.569.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.239 1.266.296 1.903.164.636-.132 1.22-.447 1.68-.907.46-.46.776-1.044.908-1.681s.075-1.299-.165-1.903c.586-.274 1.084-.705 1.439-1.246.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z"> </path></g>`;
        case 'gold':
            return `<g><path d="...金V的path..." /></g>`;
        case 'gray':
            return `<g><path d="...灰V的path..." /></g>`;
        default:
            return ''; // 普通用户无认证，返回空
    }
}

function updateTweetText(tweetBody: Element, tweet: TweetObj, contentTemplate: HTMLTemplateElement): void {
    const textArea = contentTemplate.content.getElementById('tweet-text-area')!.cloneNode(true) as HTMLElement;

    const textBlock = textArea.querySelector('[data-testid="tweetText"]') as HTMLElement;
    if (!textBlock) return;

    if (tweet.content.lang) {
        textBlock.setAttribute('lang', tweet.content.lang);
    }

    const span = textBlock.querySelector('span');
    if (span) {
        span.textContent = tweet.content.fullText;
    }

    tweetBody.append(textArea);
}

function updateTweetMedia(tweetBody: Element, tweet: TweetObj, contentTemplate: HTMLTemplateElement): void {
    if (tweet.mediaEntities.length === 0) {
        return;
    }
    //TODO::different tweet obj with different media data
}

function formatCount(count: number): string {
    if (count >= 1_000_000) return (count / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (count >= 1_000) return (count / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
    return count.toString();
}

function buttonWithData(btn: HTMLElement, no: number) {
    if (!btn) {
        return
    }
    const countSpan = btn.querySelector('[data-testid="app-text-transition-container"] span span');
    if (countSpan) {
        countSpan.textContent = formatCount(no);
    }
}

function updateTweetOperationBar(tweetBody: Element, tweet: TweetObj, contentTemplate: HTMLTemplateElement): void {
    const bottomBtnDiv = contentTemplate.content.getElementById('bottom-button-area')!.cloneNode(true) as HTMLElement;

    const replyButton = bottomBtnDiv.querySelector('button[data-testid="reply"]') as HTMLElement;
    buttonWithData(replyButton, tweet.stats.tweetReplies);

    const retweetButton = bottomBtnDiv.querySelector('button[data-testid="retweet"]') as HTMLElement;
    buttonWithData(retweetButton, tweet.stats.tweetRetweets);

    const likeButton = bottomBtnDiv.querySelector('button[data-testid="like"]') as HTMLElement;
    buttonWithData(likeButton, tweet.stats.tweetLikes);

    const viewLink = bottomBtnDiv.querySelector('a[href*="/analytics"]') as HTMLAnchorElement;
    viewLink.href = `/${tweet.author.screenName}/status/${tweet.content.id}/analytics`;
    buttonWithData(viewLink, tweet.stats.tweetViews);

    const bookMark = bottomBtnDiv.querySelector('button[data-testid="bookmark"]') as HTMLElement;
    bookMark.onclick = () => {
        console.log("-------->>> book mark button click");
    }

    tweetBody.append(bottomBtnDiv);
}
