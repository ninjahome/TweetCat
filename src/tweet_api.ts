import {getBearerToken} from "./utils";

const BASE_URL = "https://x.com/i/api/graphql/M3Hpkrb8pjWkEuGdLeXMOA/UserTweets";

interface TweetRequestParams {
    userId: string;
    count: number;
}

function buildTweetURL({userId, count}: TweetRequestParams): string {
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

    return `${BASE_URL}?variables=${variables}&features=${features}&fieldToggles=${fieldToggles}`;
}

async function fetchMultipleUsersTweets(userIds: string[], count: number) {
    const requests = userIds.map(userId =>
        fetch(buildTweetURL({userId, count}), {headers: { /* headers */}}).then(res => res.json())
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
function getCSRFToken(): string {
    const cookieMatch = document.cookie.match(/ct0=([^;]+)/);
    return cookieMatch ? cookieMatch[1] : "";
}

// 动态生成headers
async function generateHeaders(): Promise<Record<string, string>> {
    return {
        'authorization': await getBearerToken(),
        'x-csrf-token': getCSRFToken(),
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


export async function fetchTweets(userId: string, maxCount: number) {

    const url = buildTweetURL({userId: userId, count: maxCount});
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
    const validTweets = result.data.user.result.timeline.timeline.instructions
        .flatMap((instruction: Instruction) => instruction.entries)
        .filter((entry: TweetEntry) => entry?.content?.entryType === 'TimelineTimelineItem')
        .slice(0, maxCount);

    console.log(validTweets);
    return validTweets;
}
