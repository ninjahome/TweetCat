import {getBearerToken} from "./utils";
import {localGet} from "./local_storage";
import {__DBK_query_id_map, UserByScreenName, UserTweets} from "./consts";

const BASE_URL = `https://x.com/i/api/graphql/`//${USER_TWEETS_QUERY_ID}/${UserTweets}
async function getUrlWithQueryID(key: string): Promise<string | null> {
    const map = await localGet(__DBK_query_id_map) as Record<string, string> || {}
    const queryID = map[key];
    if (!queryID) {
        return null;
    }

    return `${BASE_URL}${queryID}/${key}`
}

interface TweetRequestParams {
    userId: string;
    count: number;
}

async function buildTweetQueryURL({userId, count}: TweetRequestParams): Promise<string> {
    const variables = encodeURIComponent(JSON.stringify({
        userId,
        count,
        includePromotedContent: true,
        withQuickPromoteEligibilityTweetFields: true,
        withVoice: true
    }));

    const features = encodeURIComponent(JSON.stringify({
        "rweb_video_screen_enabled": false,
        "profile_label_improvements_pcf_label_in_post_enabled": true,
        "rweb_tipjar_consumption_enabled": true,
        "responsive_web_graphql_exclude_directive_enabled": true,
        "verified_phone_label_enabled": false,
        "creator_subscriptions_tweet_preview_api_enabled": true,
        "responsive_web_graphql_timeline_navigation_enabled": true,
        "responsive_web_graphql_skip_user_profile_image_extensions_enabled": false,
        "premium_content_api_read_enabled": false,
        "communities_web_enable_tweet_community_results_fetch": true,
        "c9s_tweet_anatomy_moderator_badge_enabled": true,
        "responsive_web_grok_analyze_button_fetch_trends_enabled": false,
        "responsive_web_grok_analyze_post_followups_enabled": true,
        "responsive_web_jetfuel_frame": false,
        "responsive_web_grok_share_attachment_enabled": true,
        "articles_preview_enabled": true,
        "responsive_web_edit_tweet_api_enabled": true,
        "graphql_is_translatable_rweb_tweet_is_translatable_enabled": true,
        "view_counts_everywhere_api_enabled": true,
        "longform_notetweets_consumption_enabled": true,
        "responsive_web_twitter_article_tweet_consumption_enabled": true,
        "tweet_awards_web_tipping_enabled": false,
        "responsive_web_grok_show_grok_translated_post": false,
        "responsive_web_grok_analysis_button_from_backend": true,
        "creator_subscriptions_quote_tweet_preview_enabled": false,
        "freedom_of_speech_not_reach_fetch_enabled": true,
        "standardized_nudges_misinfo": true,
        "tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled": true,
        "longform_notetweets_rich_text_read_enabled": true,
        "longform_notetweets_inline_media_enabled": true,
        "responsive_web_grok_image_annotation_enabled": true,
        "responsive_web_enhance_cards_enabled": false
    }));

    const fieldToggles = encodeURIComponent(JSON.stringify({
        "withArticlePlainText": false
    }));

    const baseUrl = await getUrlWithQueryID(UserTweets);
    if (!baseUrl) {
        console.warn("------>>> failed to load base url for UserByScreenName")
        return ""
    }
    return `${baseUrl}?variables=${variables}&features=${features}&fieldToggles=${fieldToggles}`;
}

async function fetchMultipleUsersTweets(userIds: string[], count: number) {
    const requests = userIds.map(async userId => {
            const url = await buildTweetQueryURL({userId, count});
            fetch(url, {headers: { /* headers */}}).then(res => res.json())
        }
    );
    return Promise.all(requests);
}

// // 用法：
// const kolIds = ["791197", "123456", "654321"];
// fetchMultipleUsersTweets(kolIds, 2).then(allTweets => {
//     console.log(allTweets); // 每个用户的推文数组
// });
//

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


interface TweetEntry {
    content: {
        entryType: string;
        itemContent?: {
            tweet_results: any;  // 这里你可进一步精确
        };
    };
}

interface Instruction {
    entries: TweetEntry[];
}


export async function fetchTweets(userId: string, maxCount: number = 20) {

    const url = await buildTweetQueryURL({userId: userId, count: maxCount});
    const headers = await generateHeaders();
    const response = await fetch(url, {
        method: 'GET',
        headers: headers,
        credentials: 'include',
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP error ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    let validTweets = result.data.user.result.timeline.timeline.instructions
        .flatMap((instruction: Instruction) => instruction.entries)
        .filter((entry: TweetEntry) => entry?.content?.entryType === 'TimelineTimelineItem')

    if (maxCount > 0) {
        return validTweets.slice(0, maxCount);
    }

    return validTweets;
}

export async function getUserIdByUsername(username: string): Promise<string | null> {
    const baseUrl = await getUrlWithQueryID(UserByScreenName); // 保持不变
    if (!baseUrl) {
        console.warn("------>>> failed to load base url for UserByScreenName");
        return null;
    }

    const variables = {
        screen_name: username,
    };

    const features = {
        hidden_profile_subscriptions_enabled: true,
        profile_label_improvements_pcf_label_in_post_enabled: true,
        rweb_tipjar_consumption_enabled: true,
        responsive_web_graphql_exclude_directive_enabled: true,
        verified_phone_label_enabled: false,
        subscriptions_verification_info_is_identity_verified_enabled: true,
        subscriptions_verification_info_verified_since_enabled: true,
        highlights_tweets_tab_ui_enabled: true,
        responsive_web_twitter_article_notes_tab_enabled: true,
        subscriptions_feature_can_gift_premium: true,
        creator_subscriptions_tweet_preview_api_enabled: true,
        responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
        responsive_web_graphql_timeline_navigation_enabled: true,
    };

    const fieldToggles = {
        withAuxiliaryUserLabels: true,
    };

    const url = `${baseUrl}?variables=${encodeURIComponent(JSON.stringify(variables))}&features=${encodeURIComponent(JSON.stringify(features))}&fieldToggles=${encodeURIComponent(JSON.stringify(fieldToggles))}`;

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
        console.error(`Failed to get userId for ${username}:`, response.status);
        return null;
    }

    const result = await response.json();
    console.log(result);
    const userId = result?.data?.user?.result?.rest_id;
    return userId ?? null;
}

export async function testTweetApi(userName: string) {
    try {
        const userID = await getUserIdByUsername(userName);//'elonmusk'
        if (!userID) {
            console.log("------->>> failed found user id for user name:", userName)
            return;
        }
        console.log("------>>> user id:", userID);
        const validTweets = await fetchTweets(userID, 5);
        console.log("======>>>", validTweets);
    } catch (e) {
        console.log("--------------tmp test", e)
    }
}

