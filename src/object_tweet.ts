export class TweetObj {
    id: string;
    fullText: string;
    createdAt: string;
    avatarUrl: string;
    displayName: string;
    userScreenName: string;
    verified: boolean;
    userId: string;
    userDescription: string;
    userLocation: string;
    userFollowers: number;
    tweetLikes: number;
    tweetReplies: number;
    tweetRetweets: number;
    tweetBookmarks: number;
    tweetViews: number;
    cardTitle?: string;
    cardDescription?: string;
    cardImage?: string;
    cardUrl?: string;
    mediaUrls: string[];

    constructor(entry: any) {
        const tweet = entry.content.itemContent.tweet_results.result;
        const legacy = tweet.legacy;
        const user = tweet.core.user_results.result;
        const userLegacy = user.legacy;
        const card = tweet.card?.legacy?.binding_values || [];

        this.id = legacy.id_str;
        this.fullText = legacy.full_text;
        this.createdAt = legacy.created_at;
        this.userScreenName = userLegacy.screen_name;
        this.displayName = userLegacy.name;
        this.verified = userLegacy.verified || user.is_blue_verified;
        this.avatarUrl = userLegacy.profile_image_url_https;
        this.userId = user.rest_id;
        this.userDescription = userLegacy.description;
        this.userLocation = userLegacy.location;
        this.userFollowers = userLegacy.followers_count;
        this.tweetLikes = legacy.favorite_count;
        this.tweetReplies = legacy.reply_count;
        this.tweetRetweets = legacy.retweet_count;
        this.tweetBookmarks = legacy.bookmark_count;
        this.tweetViews = parseInt(tweet.views?.count || '0');

        this.cardTitle = TweetObj.extractCardValue(card, 'title');
        this.cardDescription = TweetObj.extractCardValue(card, 'description');
        this.cardImage = TweetObj.extractCardImage(card, [
            'summary_photo_image_large',
            'summary_photo_image',
            'photo_image_full_size_large'
        ]);
        this.cardUrl = TweetObj.extractCardValue(card, 'card_url');

        this.mediaUrls = legacy.extended_entities?.media?.map((m: any) => m.media_url_https) || [];
    }

    private static extractCardValue(card: any[], key: string): string | undefined {
        return card.find((v: any) => v.key === key)?.value?.string_value;
    }

    private static extractCardImage(card: any[], keys: string[]): string | undefined {
        for (const key of keys) {
            const imageUrl = card.find((v: any) => v.key === key)?.value?.image_value?.url;
            if (imageUrl) return imageUrl;
        }
        return undefined;
    }
}

export function renderTweetHTML(index: number, tweet: TweetObj, cellDiv: HTMLDivElement, estimatedHeight: number = 350): void {
    cellDiv.style.transform = `translateY(${index * estimatedHeight}px)`;

    const container = cellDiv.querySelector('[data-testid="tweet"]');
    if (!container) return;

    const avatarContainer = container.querySelector('[data-testid="Tweet-User-Avatar"]') as HTMLElement;
    if (!avatarContainer) return;

    const avatarBox = avatarContainer.querySelector('[data-testid^="UserAvatar-Container-"]') as HTMLElement;
    if (avatarBox) {
        avatarBox.setAttribute('data-testid', `UserAvatar-Container-${tweet.userScreenName}`);
    }

    const avatarLink = avatarContainer.querySelector('a[href^="/"]') as HTMLAnchorElement;
    if (avatarLink) {
        avatarLink.href = `/${tweet.userScreenName}`;
    }
}
