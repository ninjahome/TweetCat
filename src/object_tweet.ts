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

export function renderTweetHTML(tweet: TweetObj, container: HTMLDivElement): void {
    const avatar = container.querySelector('.tweet-avatar') as HTMLImageElement;
    const user = container.querySelector('.tweet-user') as HTMLDivElement;
    const text = container.querySelector('.tweet-text') as HTMLDivElement;
    const mediaWrapper = container.querySelector('.tweet-media') as HTMLDivElement;

    avatar.src = tweet.avatarUrl;
    avatar.alt = `${tweet.displayName} avatar`;
    avatar.style.width = '40px';
    avatar.style.height = '40px';
    avatar.style.borderRadius = '50%';

    user.textContent = `${tweet.displayName} (@${tweet.userScreenName})`;
    user.style.fontWeight = 'bold';

    text.textContent = tweet.fullText;
    text.style.marginTop = '8px';

    mediaWrapper.innerHTML = '';
    if (tweet.mediaUrls.length) {
        tweet.mediaUrls.forEach(url => {
            const img = document.createElement('img');
            img.src = url;
            img.style.maxWidth = '100%';
            img.style.borderRadius = '8px';
            img.style.marginTop = '8px';
            mediaWrapper.appendChild(img);
        });
    }
}