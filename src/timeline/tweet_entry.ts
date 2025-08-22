// Tweet Classes V2

// --- 基础类 ---

import {WrapEntryObj} from "./db_raw_tweet";
import {logRC, logTOP} from "../common/debug_flags";
import {isXArticle, toHttps} from "../common/utils";

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

    expandedUrl?: string;   // 完整 expanded（含 path/query）
    entityUrl?: string;     // 对应卡片的 t.co 链接

    constructor(data: any) {
        // === 原始字段 ===
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

                // === 新增：直接取 player_url 作为 expandedUrl ===
                case 'player_url':
                    this.expandedUrl = v?.string_value || this.expandedUrl;
                    break;

                // === 原有图片处理 ===
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

                // === 新增：player_image 系列也直接加入 images ===
                case 'player_image':
                case 'player_image_small':
                case 'player_image_large':
                case 'player_image_original':
                case 'player_image_x_large':
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
                case 'player_image_color':
                    const colorPalette = v?.image_color_value?.palette || [];
                    for (const palette of colorPalette) {
                        this.thumbnailColorPalette.push(
                            new TweetCardColor(palette.rgb, palette.percentage)
                        );
                    }
                    break;

                // [ADD] ====== broadcast 系列：标题 / 链接 ======
                case 'broadcast_title':
                    this.title = v?.string_value || this.title;
                    break;
                case 'broadcast_url': {
                    const u = toHttps(v?.string_value || '');
                    if (u) {
                        // expandedUrl / vanityUrl 优先只在未设置时填充，避免覆盖别的卡已有值
                        if (!this.expandedUrl) this.expandedUrl = u;
                        if (!this.vanityUrl) this.vanityUrl = u;
                        // 尝试补 domain（broadcast 常无 domain/vanity）
                        if (!this.domain) {
                            try {
                                this.domain = new URL(u).host;
                            } catch {
                            }
                        }
                    }
                    break;
                }

// [ADD] ====== broadcast 系列：缩略图（加入 images 并设置 mainImageUrl）======
                case 'broadcast_thumbnail':
                case 'broadcast_thumbnail_small':
                case 'broadcast_thumbnail_large':
                case 'broadcast_thumbnail_x_large':
                case 'broadcast_thumbnail_original': {
                    const img = v?.image_value;
                    if (img?.url) {
                        const httpsUrl = toHttps(img.url);
                        this.images.push(new TweetCardImage({url: httpsUrl, width: img.width, height: img.height}));
                        if (!this.mainImageUrl) this.mainImageUrl = httpsUrl;
                    }
                    break;
                }

// [ADD] ====== broadcast 系列：缩略图调色板 ======
                case 'broadcast_thumbnail_color': {
                    const colorPalette = v?.image_color_value?.palette || [];
                    for (const palette of colorPalette) {
                        this.thumbnailColorPalette.push(
                            new TweetCardColor(palette.rgb, palette.percentage)
                        );
                    }
                    break;
                }

            }
        }

        // [ADD] 统一在入口层解析 unified_card（binding_values → 通用字段）
        if (this.name === 'unified_card') {
            const rawUnified = parseUnifiedBindingString(bindingValues);
            if (rawUnified) {
                inflateUnifiedCard(rawUnified, this);
            }
        }
        // [ADD END]

        const rawCardUrl = data.legacy?.url || '';
        if (rawCardUrl?.startsWith('http://') || rawCardUrl?.startsWith('https://')) {
            this.entityUrl = rawCardUrl;
        } else {
            this.entityUrl = this.url || '';
        }
        // 如果 expandedUrl 还没设置，且 vanity_url 看起来不是裸域名，就用 vanityUrl
        if (!this.expandedUrl && this.vanityUrl) {
            try {
                const u = new URL(this.vanityUrl, 'https://_');
                const hasPathOrQuery = u.pathname !== '/' || !!u.search;
                if (hasPathOrQuery) this.expandedUrl = this.vanityUrl;
            } catch { /* ignore */
            }
        }

        // mainImageUrl 兜底：images[] 第一个有 url 的
        if (!this.mainImageUrl && this.images.length) {
            const firstWithUrl = this.images.find(it => !!it.url);
            if (firstWithUrl) this.mainImageUrl = firstWithUrl.url;
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

export function buildFallbackTweetCard(raw: TweetContent): TweetCard | null {
    try {
        logRC("------->>>>>buildFallbackTweetCard :\n", {
            text: raw.full_text,
            urls: raw.entities?.urls?.map(u => ({
                url: u.url,
                expanded: u.expanded_url,
                display: u.display_url,
                hasUnwound: !!(u as any).unwound
            }))
        });

        const u = raw.entities?.urls?.find(e => isXArticle(e.expanded_url));
        if (!u) {
            logRC("------->>>>>fallback: no x.com/i/article in entities.urls");
            return null;
        }

        const unwound = (u as any).unwound ?? null;
        const expanded = toHttps(u.expanded_url || "");
        logRC("------->>>>>fallback: picked url", {
            tco: u.url,
            expanded,
            hasUnwound: !!unwound,
            unwoundKeys: unwound ? Object.keys(unwound) : [],
            title: unwound?.title,
            description: unwound?.description,
            thumb: unwound?.thumbnail_url,
            image: unwound?.image_url
        });

        const img = unwound?.thumbnail_url || unwound?.image_url || undefined;

        const entry = {
            // 统一为大图模板，避免 “x.com 小卡片” 的退化
            name: "summary_large_image",
            domain: "x.com",
            // 链接字段
            url: u.url,                 // t.co
            entityUrl: u.url,           // ★ 新增：也放到 entityUrl，便于隐藏
            expandedUrl: expanded,
            vanityUrl: expanded,
            // 文本 + 图片
            title: unwound?.title || "x.com",
            description: unwound?.description || "",
            mainImageUrl: img,
            images: img ? [{url: img}] : []
        } as unknown as TweetCard;

        logRC("------->>>>>fallback: built card entry", {
            name: (entry as any).name,
            expandedUrl: (entry as any).expandedUrl,
            mainImageUrl: (entry as any).mainImageUrl,
            images: (entry as any).images?.map((i: any) => i?.url)
        });

        return entry;
    } catch (err) {
        logRC("------->>>>>fallback: error", String(err));
        return null;
    }
}

function buildArticleTweetCard(raw: any): TweetCard | null {
    const art = raw?.article?.article_results?.result;
    if (!art) return null;

    const legacy = raw?.legacy;
    const u = legacy?.entities?.urls?.find((e: any) => isXArticle(e?.expanded_url));
    const tco = u?.url;
    const expanded0 = u?.expanded_url || (art?.rest_id ? `https://x.com/i/article/${art.rest_id}` : "");
    const expanded = toHttps(expanded0);

    const img = art?.cover_media?.media_info?.original_img_url as string | undefined;
    const title = art?.title as string | undefined;
    const desc = art?.preview_text as string | undefined;

    return {
        // 统一用大图卡，保持与官方一致
        name: "summary_large_image",
        // 文本
        title,
        description: desc || "",
        domain: "x.com",
        // 链接（t.co 用于隐藏，expanded 用于渲染/内部路由）
        url: tco || expanded || "#",
        entityUrl: tco || "",          // ★ 新增：便于隐藏短链
        expandedUrl: expanded || "",
        vanityUrl: expanded || "https://x.com",
        // 图片
        mainImageUrl: img,
        images: img ? [{url: img}] : [],
        // 可选：补 restId（不是必须，但有用）
        restId: art?.rest_id || ""
    } as TweetCard;
}

// [ADD] ------- unified_card 解析工具（最小实现） -------
type UnifiedCardRaw = {
    type?: string; // e.g. "image_website"
    component_objects?: any;
    destination_objects?: Record<string, any>;
    media_entities?: Record<string, any>;
};

function parseUnifiedBindingString(bindingValues: any[]): UnifiedCardRaw | null {
    const bv = bindingValues?.find?.((x: any) => x?.key === "unified_card");
    const s = bv?.value?.string_value;
    if (!s || typeof s !== "string") return null;
    try {
        return JSON.parse(s) as UnifiedCardRaw;
    } catch {
        return null;
    }
}

function inflateUnifiedCard(raw: UnifiedCardRaw, card: any) {
    if (!raw) return;

    // details（标题 / 副标题 / 目的地 key）
    const details = raw.component_objects?.details_1?.data || {};
    const title = details?.title?.content || "";
    const subtitle = details?.subtitle?.content || ""; // 常见为域名
    const destKey = details?.destination || "";

    if (title && !card.title) card.title = title;

    // destination（expandedUrl / vanity）
    const urlData = raw.destination_objects?.[destKey]?.data?.url_data || {};
    const expanded = urlData?.url || "";
    const vanity = urlData?.vanity || subtitle || "";

    if (expanded && !card.expandedUrl) card.expandedUrl = toHttps(expanded);
    if (vanity && !card.vanityUrl) card.vanityUrl = toHttps(vanity);

    // domain：从 vanity/subtitle 或 expanded 的 URL 解析
    if (!card.domain) {
        let d = vanity || subtitle || "";
        if (!d && expanded) {
            try {
                d = new URL(expanded).host;
            } catch {
            }
        }
        card.domain = d || card.domain;
    }

    // 优先处理轮播：swipeable_media_1
    const swipe = raw.component_objects?.swipeable_media_1?.data?.media_list;
    // 确保 images 是数组，并做 URL 去重（避免重复 push）
    if (!Array.isArray(card.images)) card.images = [];
    const seen = new Set(card.images.map((i: any) => i?.url).filter(Boolean));

    if (Array.isArray(swipe) && swipe.length) {
        for (const item of swipe) {
            const id = item?.id;
            const m = id ? raw.media_entities?.[id] : null;
            const src = m?.media_url_https || m?.media_url;
            if (!src) continue;

            const httpsUrl = toHttps(src);
            if (!seen.has(httpsUrl)) {
                card.images.push({
                    url: httpsUrl,
                    width: m?.original_info?.width || 0,
                    height: m?.original_info?.height || 0
                });
                seen.add(httpsUrl);
            }

            if (!card.mainImageUrl) {
                card.mainImageUrl = httpsUrl;
                // 可选：补充调色板（取第一张）
                const palette = m?.ext?.mediaColor?.r?.ok?.palette || [];
                for (const c of palette) {
                    card.thumbnailColorPalette.push(new TweetCardColor(c.rgb, c.percentage));
                }
            }
        }
    } else {
        // 单图兜底：media_1
        const mediaId = raw.component_objects?.media_1?.data?.id;
        const m = mediaId ? raw.media_entities?.[mediaId] : null;
        const src = m?.media_url_https || m?.media_url || "";
        if (src) {
            const httpsImg = toHttps(src);
            if (!seen.has(httpsImg)) {
                card.images.push({
                    url: httpsImg,
                    width: m?.original_info?.width || 0,
                    height: m?.original_info?.height || 0
                });
                seen.add(httpsImg);
            }
            card.mainImageUrl ||= httpsImg;

            // 可选：补充调色板
            const palette = m?.ext?.mediaColor?.r?.ok?.palette || [];
            for (const c of palette) {
                card.thumbnailColorPalette.push(new TweetCardColor(c.rgb, c.percentage));
            }
        }
    }
    // ========= media 结束 =========
}

// [ADD END] ---------------------------------------------


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
    quotedStatus?: TweetObj;
    hasNoteExpandable?: boolean;

    constructor(raw: any, isQuoted = false) {
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
        const nt = raw?.note_tweet;
        const ntr = raw?.note_tweet_results?.result;
        this.hasNoteExpandable = !!(nt?.is_expandable || ntr);

        this.card = data.card ? new TweetCard(data.card) : null;

        if (!this.card) {
            const fromArticle = buildArticleTweetCard(data);
            if (fromArticle) {
                logRC("fallback-source: article node used");
                this.card = fromArticle as any;
            }
        }

        if (!this.card) {
            const fallback = buildFallbackTweetCard(this.tweetContent);
            if (fallback) {
                logRC("fallback-source: entities.urls used");
                this.card = fallback as any;
            }
        }

        if (data?.legacy?.retweeted_status_result?.result) {
            this.retweetedStatus = new TweetObj(
                data.legacy.retweeted_status_result.result
            );
        }
        if (!isQuoted) {
            const q = data?.quoted_status_result?.result ?? data?.legacy?.quoted_status_result?.result;
            if (q?.__typename === 'Tweet') {
                this.quotedStatus = new TweetObj(q, /*isQuoted*/ true);
            }
            // 如果是 tombstone，先记个标记（后面 step6-5 再渲染墓碑）
            // else if (q?.__typename === 'TextTombstone') { this.quotedTombstone = extractTombstoneText(q); }
        }

        const r = data?.legacy?.retweeted_status_result?.result ?? data?.retweeted_status_result?.result;
        if (r?.__typename === 'Tweet' && r?.core?.user_results?.result) {
            this.retweetedStatus = new TweetObj(r, /*isQuoted*/ false);
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
        logTOP("------->>>>>entry obj raw data:\n", JSON.stringify(entry));
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
            console.warn("unknown entry type", entry);
        }
    }

    logTOP("---------->>>next:", bottomCursor, "top:", topCursor)
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