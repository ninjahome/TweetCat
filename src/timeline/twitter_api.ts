import {extractMissingFeature, getBearerToken} from "../common/utils";
import {localGet} from "../common/local_storage";
import {
    __DBK_query_id_map,
    BlueVerifiedFollowers, Bookmarks, CreateBookmark, CreateGrokConversation, DeleteBookmark,
    Followers,
    Following, HomeTimeline,
    UserByScreenName,
    UserTweets
} from "../common/consts";
import {
    FollowResult,
    FollowUser,
    parseFollowingFromGraphQL,
    parseTimelineFromGraphQL,
    TweetResult
} from "./tweet_entry";
import {getTransactionIdFor} from "../content/txid";
import {logATA} from "../common/debug_flags";

const BASE_URL = `https://x.com/i/api/graphql/`//${USER_TWEETS_QUERY_ID}/${UserTweets}
async function getUrlWithQueryID(
    key: string
): Promise<{ url: string; path: string } | null> {
    const map = (await localGet(__DBK_query_id_map)) as Record<string, string> || {};
    const queryID = map[key];
    if (!queryID) {
        return null;
    }

    const url = `${BASE_URL}${queryID}/${key}`;
    const path = new URL(url).pathname; // 例如: /i/api/graphql/<qid>/<key>
    return {url, path};
}

interface TweetRequestParams {
    userId: string;
    count: number;
    cursor?: string; // 可选 cursor
}

async function buildTweetQueryURL({userId, count, cursor}: TweetRequestParams): Promise<string> {
    const variablesObj: any = {
        userId,
        count,
        includePromotedContent: true,
        withQuickPromoteEligibilityTweetFields: true,
        withVoice: true
    };

    // 添加 cursor 参数（如果存在）
    if (cursor) {
        variablesObj.cursor = cursor;
    }

    const variables = encodeURIComponent(JSON.stringify(variablesObj));

    const features = encodeURIComponent(JSON.stringify({
        responsive_web_grok_imagine_annotation_enabled: true,
        rweb_xchat_enabled: false,
        rweb_video_screen_enabled: false,
        profile_label_improvements_pcf_label_in_post_enabled: true,
        rweb_tipjar_consumption_enabled: true,
        responsive_web_graphql_exclude_directive_enabled: true,
        verified_phone_label_enabled: false,
        creator_subscriptions_tweet_preview_api_enabled: true,
        responsive_web_graphql_timeline_navigation_enabled: true,
        responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
        premium_content_api_read_enabled: false,
        communities_web_enable_tweet_community_results_fetch: true,
        c9s_tweet_anatomy_moderator_badge_enabled: true,
        responsive_web_grok_analyze_button_fetch_trends_enabled: false,
        responsive_web_grok_analyze_post_followups_enabled: true,
        responsive_web_jetfuel_frame: false,
        responsive_web_grok_share_attachment_enabled: true,
        articles_preview_enabled: true,
        responsive_web_edit_tweet_api_enabled: true,
        graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
        view_counts_everywhere_api_enabled: true,
        longform_notetweets_consumption_enabled: true,
        responsive_web_twitter_article_tweet_consumption_enabled: true,
        tweet_awards_web_tipping_enabled: false,
        responsive_web_grok_show_grok_translated_post: false,
        responsive_web_grok_analysis_button_from_backend: true,
        creator_subscriptions_quote_tweet_preview_enabled: false,
        freedom_of_speech_not_reach_fetch_enabled: true,
        standardized_nudges_misinfo: true,
        tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
        longform_notetweets_rich_text_read_enabled: true,
        longform_notetweets_inline_media_enabled: true,
        responsive_web_grok_image_annotation_enabled: true,
        responsive_web_enhance_cards_enabled: false,
        responsive_web_grok_community_note_auto_translation_is_enabled: true,
        payments_enabled: false,
    }));


    const fieldToggles = encodeURIComponent(JSON.stringify({
        "withArticlePlainText": false
    }));

    const bp = await getUrlWithQueryID(UserTweets);
    if (!bp) {
        console.warn("------>>> failed to load base url for UserByScreenName")
        return ""
    }
    return `${bp.url}?variables=${variables}&features=${features}&fieldToggles=${fieldToggles}`;
}

// 提取 csrf token
function getCsrfToken(): string {
    const cookieMatch = document.cookie.match(/ct0=([^;]+)/);
    return cookieMatch ? cookieMatch[1] : "";
}

// 动态生成headers
async function generateHeaders(): Promise<Record<string, string>> {
    return {
        'authorization': await getBearerToken(),
        'x-csrf-token': getCsrfToken(),
        'x-twitter-active-user': 'yes',
        'x-twitter-auth-type': 'OAuth2Session',
        'x-twitter-client-language': 'en',
        'content-type': 'application/json',
        'accept': '*/*',
        'referer': 'https://x.com/',
        'user-agent': navigator.userAgent,
    };
}

export async function getUserIdByUsername(username: string): Promise<string | null> {
    const bp = await getUrlWithQueryID(UserByScreenName); // 保持不变
    if (!bp) {
        console.warn("------>>> failed to load base url for UserByScreenName");
        return null;
    }

    const variables = {
        screen_name: username,
    };

    const features = {
        responsive_web_grok_bio_auto_translation_is_enabled: false,
        hidden_profile_subscriptions_enabled: true,
        payments_enabled: false,
        profile_label_improvements_pcf_label_in_post_enabled: true,
        rweb_tipjar_consumption_enabled: true,
        verified_phone_label_enabled: false,
        subscriptions_verification_info_is_identity_verified_enabled: true,
        subscriptions_verification_info_verified_since_enabled: true,
        highlights_tweets_tab_ui_enabled: true,
        responsive_web_twitter_article_notes_tab_enabled: true,
        subscriptions_feature_can_gift_premium: true,
        creator_subscriptions_tweet_preview_api_enabled: true,
        responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
        responsive_web_graphql_timeline_navigation_enabled: true,
        rweb_xchat_enabled: false,
    };

    const fieldToggles = {
        withAuxiliaryUserLabels: true,
    };

    const url = `${bp.url}?variables=${encodeURIComponent(JSON.stringify(variables))}&features=${encodeURIComponent(JSON.stringify(features))}&fieldToggles=${encodeURIComponent(JSON.stringify(fieldToggles))}`;

    const headers = {
        'authorization': await getBearerToken(),
        'x-csrf-token': getCsrfToken(),
        'x-twitter-auth-type': 'OAuth2Session',
        'x-twitter-active-user': 'yes',
        'content-type': 'application/json',
    };

    const response = await fetch(url, {
        method: 'GET',
        headers,
        credentials: 'include',
    });

    if (!response.ok) {
        const errorText = await response.text();  // 打印原始 body
        console.error(`❌ Failed to get userId for ${username}: ${response.status}\n${errorText}`);
        return null;
    }

    const result = await response.json();
    const userId = result?.data?.user?.result?.rest_id;
    // console.log("--------------->>>>>userID:", userId, " name=", username)
    return userId ?? null;
}

export async function fetchTweets(userId: string, maxCount: number = 20, cursor?: string): Promise<TweetResult> {
    const url = await buildTweetQueryURL({userId, count: maxCount, cursor: cursor});
    const headers = await generateHeaders();
    const response = await fetch(url, {
        method: 'GET',
        headers,
        credentials: 'include',
    });

    if (!response.ok) {
        const errorText = await response.text();
        const missing_param = extractMissingFeature(errorText);
        console.log("------>>> missing param:", missing_param)
        throw new Error(`HTTP error ${response.status}: ${errorText}`);
    }
    const result = await response.json();
    // console.log("---------------->>>\n", result);
    return parseTimelineFromGraphQL(result, "tweets");
}


async function buildFollowingURL(params: {
    userId: string;
    count?: number;
    cursor?: string;
}): Promise<string> {
    const bp = await getUrlWithQueryID(Following); // 从本地 queryId 映射取
    if (!bp) throw new Error("Missing queryId for 'Following'");

    const variables: any = {
        userId: params.userId,
        count: params.count ?? 20,
        includePromotedContent: false,
        withGrokTranslatedBio: false,
    };
    if (params.cursor) variables.cursor = params.cursor;

    // features 建议与页面抓到的保持一致；这里给出一个稳定子集即可
    const features = {
        rweb_video_screen_enabled: false,
        payments_enabled: false,
        rweb_xchat_enabled: false,
        profile_label_improvements_pcf_label_in_post_enabled: true,
        rweb_tipjar_consumption_enabled: true,
        verified_phone_label_enabled: false,
        creator_subscriptions_tweet_preview_api_enabled: true,
        responsive_web_graphql_timeline_navigation_enabled: true,
        responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
        premium_content_api_read_enabled: false,
        communities_web_enable_tweet_community_results_fetch: true,
        c9s_tweet_anatomy_moderator_badge_enabled: true,
        responsive_web_grok_analyze_button_fetch_trends_enabled: false,
        responsive_web_grok_analyze_post_followups_enabled: true,
        responsive_web_jetfuel_frame: true,
        responsive_web_grok_share_attachment_enabled: true,
        articles_preview_enabled: true,
        responsive_web_edit_tweet_api_enabled: true,
        graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
        view_counts_everywhere_api_enabled: true,
        longform_notetweets_consumption_enabled: true,
        responsive_web_twitter_article_tweet_consumption_enabled: true,
        tweet_awards_web_tipping_enabled: false,
        responsive_web_grok_show_grok_translated_post: false,
        responsive_web_grok_analysis_button_from_backend: true,
        creator_subscriptions_quote_tweet_preview_enabled: false,
        freedom_of_speech_not_reach_fetch_enabled: true,
        standardized_nudges_misinfo: true,
        tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
        longform_notetweets_rich_text_read_enabled: true,
        longform_notetweets_inline_media_enabled: true,
        responsive_web_grok_image_annotation_enabled: true,
        responsive_web_grok_imagine_annotation_enabled: true,
        responsive_web_grok_community_note_auto_translation_is_enabled: false,
        responsive_web_enhance_cards_enabled: false,
    };

    return `${bp.url}?variables=${encodeURIComponent(JSON.stringify(variables))}`
        + `&features=${encodeURIComponent(JSON.stringify(features))}`;
}

export async function fetchFollowingPage(
    userId: string,
    count = 50,
    cursor?: string
): Promise<FollowResult> {
    const url = await buildFollowingURL({userId, count, cursor});
    const headers = await generateHeaders(); // 不需要 x-client-transaction-id / x-xp-forwarded-for
    const resp = await fetch(url, {
        method: "GET",
        headers,
        credentials: "include",
    });

    const text = await resp.text();
    if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${text}`);
    }
    const json = text ? JSON.parse(text) : {};
    return parseFollowingFromGraphQL(json);
}

/**
 * 构造 Followers 请求 URL
 */
function buildFollowersUrl(userId: string, count = 20, cursor?: string): string {
    const variablesObj: any = {
        userId,
        count,
        includePromotedContent: false,
        withGrokTranslatedBio: false,
    };
    if (cursor) variablesObj.cursor = cursor;
    const variables = encodeURIComponent(JSON.stringify(variablesObj));

    const featuresObj = {
        rweb_video_screen_enabled: false,
        payments_enabled: false,
        rweb_xchat_enabled: false,
        profile_label_improvements_pcf_label_in_post_enabled: true,
        rweb_tipjar_consumption_enabled: true,
        verified_phone_label_enabled: false,
        creator_subscriptions_tweet_preview_api_enabled: true,
        responsive_web_graphql_timeline_navigation_enabled: true,
        responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
        premium_content_api_read_enabled: false,
        communities_web_enable_tweet_community_results_fetch: true,
        c9s_tweet_anatomy_moderator_badge_enabled: true,
        responsive_web_grok_analyze_button_fetch_trends_enabled: false,
        responsive_web_grok_analyze_post_followups_enabled: true,
        responsive_web_jetfuel_frame: true,
        responsive_web_grok_share_attachment_enabled: true,
        articles_preview_enabled: true,
        responsive_web_edit_tweet_api_enabled: true,
        graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
        view_counts_everywhere_api_enabled: true,
        longform_notetweets_consumption_enabled: true,
        responsive_web_twitter_article_tweet_consumption_enabled: true,
        tweet_awards_web_tipping_enabled: false,
        responsive_web_grok_show_grok_translated_post: false,
        responsive_web_grok_analysis_button_from_backend: false,
        creator_subscriptions_quote_tweet_preview_enabled: false,
        freedom_of_speech_not_reach_fetch_enabled: true,
        standardized_nudges_misinfo: true,
        tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
        longform_notetweets_rich_text_read_enabled: true,
        longform_notetweets_inline_media_enabled: true,
        responsive_web_grok_image_annotation_enabled: true,
        responsive_web_grok_imagine_annotation_enabled: true,
        responsive_web_grok_community_note_auto_translation_is_enabled: false,
        responsive_web_enhance_cards_enabled: false,
    };

    const features = encodeURIComponent(JSON.stringify(featuresObj));

    return `?variables=${variables}&features=${features}`;
}

export async function fetchFollowersPage(
    userId: string,
    count = 20,
    cursor?: string
): Promise<{ users: FollowUser[]; nextCursor?: string }> {
    return _followApi(Followers, userId, count, cursor)
}


export async function fetchBlueVerifiedFollowersPage(
    userId: string,
    count = 20,
    cursor?: string): Promise<{ users: FollowUser[]; nextCursor?: string }> {
    return _followApi(BlueVerifiedFollowers, userId, count, cursor);
}

export async function _followApi(
    api: string,
    userId: string,
    count = 20,
    cursor?: string
): Promise<{ users: FollowUser[]; nextCursor?: string }> {

    const bp = await getUrlWithQueryID(api);
    if (!bp) {
        throw new Error("Missing queryId for " + api);
    }
    const query = buildFollowersUrl(userId, count, cursor);
    const fullUrl = `${bp.url}${query}`;

    const txid = await getTransactionIdFor("GET", bp.path);

    const headers: Record<string, string> = {
        "authorization": await getBearerToken(),  // ✅ 你已有
        "x-client-transaction-id": txid,
        "x-csrf-token": getCsrfToken(),           // ✅ 你已有
        "x-twitter-active-user": "yes",
        "x-twitter-auth-type": "OAuth2Session",
        "x-twitter-client-language": "zh-cn",
    };

    const res = await fetch(fullUrl, {method: "GET", credentials: "include", headers});
    if (!res.ok) {
        if (res.status === 400 || res.status === 403) {
            const text = await res.text().catch(() => "");
            extractMissingFeature?.(text);
        }
        throw new Error(`Followers request failed: ${res.status} ${res.statusText}`);
    }
    const data = await res.json();

    const {users, nextCursor} = parseFollowingFromGraphQL(data) as FollowResult;
    return {users, nextCursor};
}

export async function bookmarkApi(
    tweetId: string,
    isCreate: boolean
): Promise<boolean> {
    const apiKey = isCreate ? CreateBookmark : DeleteBookmark;

    const bp = await getUrlWithQueryID(apiKey);
    if (!bp) {
        throw new Error("Missing queryId for " + apiKey);
    }
    const txid = await getTransactionIdFor("POST", bp.path);

    const headers = await generateHeaders();
    headers["content-type"] = "application/json";
    headers["x-client-transaction-id"] = txid;

    const body = JSON.stringify({
        variables: {tweet_id: tweetId},
    });

    const resp = await fetch(bp.url, {
        method: "POST",
        headers,
        credentials: "include",
        body,
    });

    if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        extractMissingFeature?.(text);
        throw new Error(`HTTP ${resp.status}: ${text}`);
    }

    const json = await resp.json();
    // console.log("------>>>", json);

    const fieldName = isCreate ? "tweet_bookmark_put" : "tweet_bookmark_delete";

    const result = json?.data?.[fieldName];
    if (result === "Done") {
        return true;
    }

    const message = json?.errors?.[0]?.message || "Unknown error";
    throw new Error(message);
}


// ========== HomeTimeline ==========

/**
 * 生成 HomeTimeline GraphQL 请求 URL（只需要 count + cursor）
 */
async function buildHomeTimelineURL(count: number = 40, cursor?: string): Promise<string> {
    const bp = await getUrlWithQueryID(HomeTimeline);
    if (!bp) {
        throw new Error("Missing queryId for 'HomeTimeline'");
    }

    const variablesObj: any = {
        count,
        includePromotedContent: false,
        latestControlAvailable: false,
        withCommunity: false,
    };
    if (cursor) variablesObj.cursor = cursor;

    const variables = encodeURIComponent(JSON.stringify(variablesObj));

    const features = encodeURIComponent(JSON.stringify({
        rweb_video_screen_enabled: false,
        payments_enabled: false,
        rweb_xchat_enabled: false,
        profile_label_improvements_pcf_label_in_post_enabled: true,
        rweb_tipjar_consumption_enabled: true,
        verified_phone_label_enabled: false,
        creator_subscriptions_tweet_preview_api_enabled: true,
        responsive_web_graphql_timeline_navigation_enabled: true,
        responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
        premium_content_api_read_enabled: false,
        communities_web_enable_tweet_community_results_fetch: true,
        c9s_tweet_anatomy_moderator_badge_enabled: true,
        responsive_web_grok_analyze_button_fetch_trends_enabled: false,
        responsive_web_grok_analyze_post_followups_enabled: true,
        responsive_web_jetfuel_frame: true,
        responsive_web_grok_share_attachment_enabled: true,
        articles_preview_enabled: true,
        responsive_web_edit_tweet_api_enabled: true,
        graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
        view_counts_everywhere_api_enabled: true,
        longform_notetweets_consumption_enabled: true,
        responsive_web_twitter_article_tweet_consumption_enabled: true,
        tweet_awards_web_tipping_enabled: false,
        responsive_web_grok_show_grok_translated_post: false,
        responsive_web_grok_analysis_button_from_backend: false,
        creator_subscriptions_quote_tweet_preview_enabled: false,
        freedom_of_speech_not_reach_fetch_enabled: true,
        standardized_nudges_misinfo: true,
        tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
        longform_notetweets_rich_text_read_enabled: true,
        longform_notetweets_inline_media_enabled: true,
        responsive_web_grok_image_annotation_enabled: true,
        responsive_web_grok_imagine_annotation_enabled: true,
        responsive_web_grok_community_note_auto_translation_is_enabled: false,
        responsive_web_enhance_cards_enabled: false,
    }));

    return `${bp.url}?variables=${variables}&features=${features}`;
}

export async function fetchHomeTimeline(
    count: number = 40,
    cursor?: string
): Promise<TweetResult> {
    const url = await buildHomeTimelineURL(count, cursor);
    const headers = await generateHeaders();

    const resp = await fetch(url, {
        method: 'GET',
        headers,
        credentials: 'include',
    });

    if (!resp.ok) {
        const text = await resp.text();
        const missing = extractMissingFeature(text);
        console.log("------>>> HomeTimeline missing feature:", missing);
        throw new Error(`HTTP error ${resp.status}: ${text}`);
    }

    const json = await resp.json();
    return parseTimelineFromGraphQL(json, "home");
}


async function buildBookmarksURL(count: number = 20, cursor?: string): Promise<string> {
    const bp = await getUrlWithQueryID(Bookmarks);
    if (!bp) {
        throw new Error("Missing queryId for 'Bookmarks'");
    }

    const variablesObj: any = {
        count,
        includePromotedContent: false, // 固定
    };
    if (cursor) variablesObj.cursor = cursor;

    const variables = encodeURIComponent(JSON.stringify(variablesObj));

    // features：与你刚才通过的特性集保持一致，避免 400（必含 verified_phone_label_enabled / creator_subscriptions_tweet_preview_api_enabled）
    const features = encodeURIComponent(JSON.stringify({
        rweb_video_screen_enabled: false,
        payments_enabled: false,
        rweb_xchat_enabled: false,
        profile_label_improvements_pcf_label_in_post_enabled: true,
        rweb_tipjar_consumption_enabled: true,
        verified_phone_label_enabled: false,
        creator_subscriptions_tweet_preview_api_enabled: true,
        responsive_web_graphql_timeline_navigation_enabled: true,
        responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
        premium_content_api_read_enabled: false,
        communities_web_enable_tweet_community_results_fetch: true,
        c9s_tweet_anatomy_moderator_badge_enabled: true,
        responsive_web_grok_analyze_button_fetch_trends_enabled: false,
        responsive_web_grok_analyze_post_followups_enabled: true,
        responsive_web_jetfuel_frame: true,
        responsive_web_grok_share_attachment_enabled: true,
        articles_preview_enabled: true,
        responsive_web_edit_tweet_api_enabled: true,
        graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
        view_counts_everywhere_api_enabled: true,
        longform_notetweets_consumption_enabled: true,
        responsive_web_twitter_article_tweet_consumption_enabled: true,
        tweet_awards_web_tipping_enabled: false,
        responsive_web_grok_show_grok_translated_post: false,
        responsive_web_grok_analysis_button_from_backend: false,
        creator_subscriptions_quote_tweet_preview_enabled: false,
        freedom_of_speech_not_reach_fetch_enabled: true,
        standardized_nudges_misinfo: true,
        tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
        longform_notetweets_rich_text_read_enabled: true,
        longform_notetweets_inline_media_enabled: true,
        responsive_web_grok_image_annotation_enabled: true,
        responsive_web_grok_imagine_annotation_enabled: true,
        responsive_web_grok_community_note_auto_translation_is_enabled: false,
        responsive_web_enhance_cards_enabled: false,
    }));

    return `${bp.url}?variables=${variables}&features=${features}`;
}

/**
 * 拉取收藏列表（Bookmarks），解析仍复用 parseTimelineFromGraphQL
 */
export async function fetchBookmarks(
    count: number = 20,
    cursor?: string
): Promise<TweetResult> {
    const url = await buildBookmarksURL(count, cursor);
    const headers = await generateHeaders();

    const resp = await fetch(url, {
        method: 'GET',
        headers,
        credentials: 'include',
    });

    if (!resp.ok) {
        const text = await resp.text();
        const missing = extractMissingFeature(text);
        console.log("------>>> Bookmarks missing feature:", missing);
        throw new Error(`HTTP error ${resp.status}: ${text}`);
    }

    const json = await resp.json();
    // console.log("--------------json------------>>>", json);
    return parseTimelineFromGraphQL(json, "bookmarked");
}

export async function createGrokConversation(
    variables: Record<string, any> = {}
): Promise<string> {
    const bp = await getUrlWithQueryID(CreateGrokConversation);
    if (!bp) {
        throw new Error("Missing queryId for 'CreateGrokConversation'");
    }

    // POST 需要 transaction id
    const txid = await getTransactionIdFor("POST", bp.path);

    const headers = await generateHeaders();
    headers["content-type"] = "application/json";
    headers["x-client-transaction-id"] = txid;

    // 注意：queryId 已在 URL 中，不要放进 body
    const body = JSON.stringify({ variables });

    const resp = await fetch(bp.url, {
        method: "POST",
        headers,
        credentials: "include",
        body,
    });

    if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        extractMissingFeature?.(text);
        throw new Error(`CreateGrokConversation failed: ${resp.status} ${text}`);
    }

    type CreateConvResp = {
        data?: { create_grok_conversation?: { conversation_id?: string } };
        errors?: any[];
    };

    const json = (await resp.json()) as CreateConvResp;

    if (json?.errors?.length) {
        throw new Error(`GraphQL error: ${JSON.stringify(json.errors[0])}`);
    }

    const id = json?.data?.create_grok_conversation?.conversation_id;
    if (!id) {
        throw new Error("No conversation_id in response");
    }
    return id;
}


// 1) 新增可选项：只收 final 分片、是否清理 xai 标签
type GrokStreamOptions = {
    debug?: boolean;
    onToken?: (t: string) => void;
    onEvent?: (e: any) => void;
    signal?: AbortSignal;
    ignoreTags?: string[];      // 默认丢弃工具/头部/思考片段
    keepOnlyFinal?: boolean;    // 只收 messageTag === 'final' 的文本
    stripXaiTags?: boolean;     // 清理 <xai:...> 标签
};

type GrokMeta = { userChatItemId?: string; agentChatItemId?: string };

// 2) 文本清理：剔除 <xai:tool_usage_card> ... </xai:tool_usage_card> 以及其它 <xai:...> 标签
function sanitizeToken(s: string): string {
    if (!s) return s;
    // 整块工具卡片
    s = s.replace(/<xai:tool_usage_card[\s\S]*?<\/xai:tool_usage_card>/g, "");
    // 其它 <xai:...> 单标签/成对标签（保险起见再清一次）
    s = s.replace(/<\/?xai:[^>]+>/g, "");
    // 收敛空白
    s = s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
    return s.trim();
}

// 3) 从事件里抽取 token（如观察到别的增量路径可再扩展）
function pickToken(evt: any): string | null {
    if (!evt) return null;
    if (typeof evt?.result?.message === "string") return evt.result.message;
    if (typeof evt?.message === "string") return evt.message;
    // if (typeof evt?.result?.delta?.message === "string") return evt.result.delta.message;
    return null;
}

export async function addGrokResponse(
    conversationId: string,
    message: string,
    opts: GrokStreamOptions = {}
): Promise<{ text: string; meta: GrokMeta }> {
    const {
        debug = false,
        onToken,
        onEvent,
        signal,
        ignoreTags = ["tool_usage_card", "header", "thinking"],
        keepOnlyFinal = false,
        stripXaiTags = true,
    } = opts;
    if (!conversationId) throw new Error("Missing conversationId");
    if (!message) throw new Error("Missing message");

    const url = "https://grok.x.com/2/grok/add_response.json";
    const path = "/2/grok/add_response.json";

    const txid = await getTransactionIdFor("POST", path);
    const headers = await generateHeaders();
    headers["accept"] = headers["accept"] || "*/*";
    headers["content-type"] = "text/plain;charset=UTF-8";
    headers["x-client-transaction-id"] = txid;
    headers["x-twitter-active-user"] = headers["x-twitter-active-user"] || "yes";
    headers["x-twitter-auth-type"] = headers["x-twitter-auth-type"] || "OAuth2Session";
    headers["x-twitter-client-language"] =
        headers["x-twitter-client-language"] || (navigator.language?.toLowerCase() || "en");

    const payload = {
        responses: [{ message, sender: 1, promptSource: "", fileAttachments: [] }],
        systemPromptName: "",
        grokModelOptionId: "grok-3-latest",
        modelMode: "MODEL_MODE_FAST",
        conversationId,
        returnSearchResults: true,
        returnCitations: true,
        promptMetadata: { promptSource: "NATURAL", action: "INPUT" },
        imageGenerationCount: 4,
        requestFeatures: { eagerTweets: true, serverHistory: true },
        enableSideBySide: true,
        toolOverrides: {},
        modelConfigOverride: {},
        isTemporaryChat: false,
    };

    const timeLabel = `[grok:add_response] total ${txid.slice(0,8)}`;
    logATA("POST", url, "txid=", txid);
    console.time?.(timeLabel);

    const resp = await fetch(url, {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify(payload),
        signal,
        referrer: "https://x.com/",
        referrerPolicy: "origin-when-cross-origin",
    });

    logATA("status", resp.status, resp.statusText);
    if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        logATA("error body (first 500):", text.slice(0, 500));
        throw new Error(`add_response failed: ${resp.status} ${text}`);
    }

    const reader = resp.body?.getReader();
    const decoder = new TextDecoder("utf-8");
    const meta: GrokMeta = {};
    let finalText = "";
    let targetAgentId: string | undefined;

    let buf = "";
    let bytes = 0, chunks = 0, lines = 0, parsed = 0, tokenPieces = 0, parseErrors = 0;
    let sampleEventsLeft = 6;

    const handleLine = (rawLine: string) => {
        const line = rawLine.trim();
        if (!line) return;

        lines++;
        if (lines <= 5) logATA(`line[${lines}] head:`, line.slice(0, 140));

        try {
            const evt = JSON.parse(line);
            parsed++;
            onEvent?.(evt);

            if (evt.conversationId && evt.userChatItemId) {
                meta.userChatItemId = evt.userChatItemId;
                meta.agentChatItemId = evt.agentChatItemId;
                targetAgentId = evt.agentChatItemId;
                logATA("meta ids:", meta);
            }

            if (sampleEventsLeft-- > 0) {
                const keys = Object.keys(evt);
                const rKeys = evt?.result ? Object.keys(evt.result) : [];
                logATA("evt keys:", keys, "result keys:", rKeys);
            }

            // —— 过滤条件 ——
            const senderRaw = evt?.result?.sender ?? evt?.sender;
            const senderOk = String(senderRaw || "").toLowerCase() === "assistant";
            const idOk = !targetAgentId || evt?.result?.responseChatItemId === targetAgentId;

            const tag = evt?.result?.messageTag;
            const tagLc = tag ? String(tag).toLowerCase() : undefined;
            const tagOk = keepOnlyFinal
                ? (tagLc === "final" || tagLc === undefined)
                : (!tagLc || !ignoreTags.includes(tagLc!));

            let token = pickToken(evt);

            if (senderOk && idOk && tagOk && typeof token === "string") {
                if (stripXaiTags) token = sanitizeToken(token);
                if (token) {
                    tokenPieces++;
                    finalText += token;
                    onToken?.(token);
                    if (tokenPieces <= 10) logATA("token+", JSON.stringify(token), "tag=", tagLc);
                }
            }

            if (evt?.result?.isSoftStop) logATA("soft stop received");
        } catch {
            parseErrors++;
            if (parseErrors <= 5) logATA("JSON parse error head:", line.slice(0, 160));
        }
    };

    if (reader) {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            chunks++;
            bytes += value.byteLength;
            buf += decoder.decode(value, { stream: true });

            let idx: number;
            while ((idx = buf.indexOf("\n")) >= 0) {
                const line = buf.slice(0, idx);
                buf = buf.slice(idx + 1);
                handleLine(line.endsWith("\r") ? line.slice(0, -1) : line);
            }
        }
        const flush = decoder.decode();
        if (flush) buf += flush;
        const last = buf.trim();
        if (last) handleLine(last);
    } else {
        const all = await resp.text();
        for (const line of all.split(/\r?\n/)) handleLine(line);
    }

    logATA("stats:", { bytes, chunks, lines, parsed, tokenPieces, parseErrors });
    console.timeEnd?.(timeLabel);

    return { text: finalText, meta };
}
