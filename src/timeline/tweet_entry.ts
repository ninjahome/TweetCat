// Tweet Classes V2

// --- 基础类 ---

import {WrapEntryObj} from "./db_raw_tweet";

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


export interface VideoVariant {
    bitrate?: number;              // 有的变体（m3u8）没有 bitrate
    content_type: string;          // "video/mp4" | "application/x-mpegURL"
    url: string;
}

export interface VideoInfo {
    aspect_ratio: [number, number]; // e.g. [16,9]  /  [1,1]
    duration_millis?: number;       // animated_gif 没有
    variants: VideoVariant[];
}

export class TweetMediaEntity {
    display_url: string;
    expanded_url: string;
    id_str: string;
    media_key: string;
    media_url_https: string;
    type: 'photo' | 'video' | 'animated_gif';
    url: string;

    /** ▶️ 仅 video / animated_gif 有值 */
    video_info?: VideoInfo;
    original_info?: {
        width: number;
        height: number;
    };

    constructor(data: any) {
        this.display_url = data.display_url;
        this.expanded_url = data.expanded_url;
        this.id_str = data.id_str;
        this.media_key = data.media_key;
        this.media_url_https = data.media_url_https;
        this.type = data.type;
        this.url = data.url;

        if (data.video_info) {
            this.video_info = data.video_info as VideoInfo;
        }

        if (data.original_info?.width && data.original_info?.height) {
            this.original_info = {
                width: data.original_info.width,
                height: data.original_info.height
            };
        }
    }
}

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

export class HashtagEntity {
    text: string;
    indices: [number, number];

    constructor(data: any) {
        this.text = data.text;
        this.indices = data.indices;
    }
}

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

export class TweetExtendedEntity {
    media: TweetMediaEntity[];

    constructor(data: any) {
        this.media = (data?.media || []).map((m: any) => new TweetMediaEntity(m));
    }
}

export class TweetContent {
    bookmark_count: number;
    bookmarked: boolean;
    created_at: string;
    conversation_id_str: string;
    display_text_range: [number, number];
    entities: TweetEntity;
    extended_entities: TweetExtendedEntity;
    favorite_count: number;
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

export class TweetAuthor {
    authorID: string;
    is_blue_verified: boolean;
    legacy: AuthorLegacy;
    professional: any;
    avatarImgUrl: string;
    displayName: string;
    screenName: string;

    constructor(data: any) {
        this.authorID = data.rest_id;
        this.is_blue_verified = data.is_blue_verified;
        this.legacy = new AuthorLegacy(data.legacy);
        this.professional = data.professional;
        if (!this.legacy.profile_image_url_https) {
            this.avatarImgUrl = data.avatar?.image_url;
        } else {
            this.avatarImgUrl = this.legacy.profile_image_url_https;
        }
        if (this.legacy.displayName) {
            this.displayName = this.legacy.displayName;
        } else {
            this.displayName = data.core?.name ?? '';
        }

        if (this.legacy.screenName) {
            this.screenName = this.legacy.screenName;
        } else {
            this.screenName = data.core?.screen_name ?? '';
        }
    }
}

export class TweetObj {
    rest_id: string;
    unmention_data: any;
    author: TweetAuthor;
    edit_control: any;
    is_translatable: boolean;
    views_count: number;
    source: string;
    quick_promote_eligibility: any;
    tweetContent: TweetContent;
    card: TweetCard | null;
    retweetedStatus?: TweetObj;

    constructor(raw: any) {
        const data = raw?.tweet ?? raw;
        this.rest_id = data.rest_id;
        this.unmention_data = data.unmention_data;
        this.author = new TweetAuthor(data.core.user_results.result);
        this.edit_control = data.edit_control;
        this.is_translatable = data.is_translatable;
        this.views_count = data.views?.count ? parseInt(data.views.count) : 0;
        this.source = data.source;
        this.quick_promote_eligibility = data.quick_promote_eligibility;
        this.tweetContent = new TweetContent(data.legacy);
        this.card = data.card ? new TweetCard(data.card) : null;
        if (data?.legacy?.retweeted_status_result?.result) {
            this.retweetedStatus = new TweetObj(
                data.legacy.retweeted_status_result.result
            );
        }
    }

    get renderTarget(): TweetObj {
        return this.retweetedStatus ?? this;
    }
}

export class EntryObj {
    entryId: string;
    sortIndex: string;
    entryType: string;
    clientEventInfo: any;
    itemType: string;
    tweetDisplayType: string;
    socialContext: any;
    tweet: TweetObj;

    constructor(entry: any) {
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

// 批量解析 entries 的函数
export function extractEntryObjs(entries: any[]): TweetResult {
    const tweetEntries: EntryObj[] = [];
    const tweetRawEntries: WrapEntryObj[] = [];
    let bottomCursor: string | null = null;
    let topCursor = null;

    for (const entry of entries) {
        if (entry?.content?.entryType === 'TimelineTimelineItem') {
            try {
                const obj = new EntryObj(entry)
                tweetEntries.push(obj);
                const wrapObj = WrapEntryObj.fromEntryObj(obj, entry);
                tweetRawEntries.push(wrapObj);
            } catch (e) {
                console.warn("parse entry failed :", e, " data:", entry)
            }
        } else if (entry?.content?.entryType === 'TimelineTimelineCursor') {
            if (entry.content.cursorType === 'Bottom') bottomCursor = entry.content.value;
            else if (entry.content.cursorType === 'Top') topCursor = entry.content.value;
        } else if (entry.content.entryType === 'TimelineTimelineModule') continue;
        else {
            console.log("unknown entry type", entry);
        }
    }

    // console.log("---------->>>next:", bottomCursor, "top:", topCursor)
    return new TweetResult(tweetEntries, tweetRawEntries, bottomCursor, topCursor);
}

export class TweetResult {
    tweets: EntryObj[];
    wrapDbEntry: WrapEntryObj[];
    nextCursor: string | null;
    topCursor: string | null;

    constructor(tweets: EntryObj[], wrapDbEntry: WrapEntryObj[], next: string | null, top: string | null) {
        this.tweets = tweets;
        this.wrapDbEntry = wrapDbEntry;
        this.nextCursor = next;
        this.topCursor = top
    }
}

export function parseTimelineFromGraphQL(result: any): TweetResult {
    const instructions = result.data?.user?.result?.timeline?.timeline?.instructions || [];
    const allEntries: any[] = [];

    for (const instruction of instructions) {
        switch (instruction.type) {
            case 'TimelineAddEntries':
            case 'TimelineShowCover':
                allEntries.push(...(instruction.entries || []));
                break;
            case 'TimelinePinEntry':
            case 'TimelineReplaceEntry':
                if (instruction.entry) {
                    allEntries.push(instruction.entry);
                }
                break;
        }
    }
    return extractEntryObjs(allEntries);
}