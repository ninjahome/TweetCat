export class TweetObj {
    id: string;
    text: string;
    fullText: string;
    createdAt: string;
    avatarUrl: string;
    profileAvatarUrl: string;
    displayName: string;
    userScreenName: string;
    verified: boolean;
    userId: string;
    isVerified: boolean;
    verifiedType: string | null;
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
    lang?: string;

    constructor(entry: any) {
        const tweet = entry.content.itemContent.tweet_results.result;
        const legacy = tweet.legacy;
        const user = tweet.core.user_results.result;
        const userLegacy = user.legacy;
        const card = tweet.card?.legacy?.binding_values || [];

        this.id = legacy.id_str;
        this.fullText = legacy.full_text;
        this.text = tweet.full_text || '';
        this.lang = tweet.lang || 'und';
        this.createdAt = legacy.created_at;
        this.userScreenName = userLegacy.screen_name;
        this.displayName = userLegacy.name;
        this.verified = userLegacy.verified || user.is_blue_verified;
        this.avatarUrl = user?.legacy?.profile_image_url_https || '';
        this.profileAvatarUrl = user?.profile_image_url_https || '';
        this.userId = user.rest_id;
        this.isVerified = user.verified; // true / false
        this.verifiedType = user?.legacy?.verified_type || '';

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

    updateTweetAvatar(container, tweet);
    updateTweetProfile(container, tweet);
    updateTweetText(container, tweet);
}

function updateTweetAvatar(container: Element, tweet: TweetObj): void {
    const avatarContainer = container.querySelector('[data-testid="Tweet-User-Avatar"]') as HTMLElement;
    if (!avatarContainer) return;

    const avatarBox = avatarContainer.querySelector('[data-testid^="UserAvatar-Container-"]') as HTMLElement;
    if (avatarBox) {
        avatarBox.setAttribute('data-testid', `UserAvatar-Container-${tweet.userScreenName}`);
    }

    const avatarLink = avatarContainer.querySelector('a[href^="/"]') as HTMLAnchorElement;
    if (avatarLink) {
        avatarLink.href = `/${tweet.userScreenName}`;

        const bgDiv = avatarLink.querySelector('div[style*="background-image"]') as HTMLElement;
        if (bgDiv) {
            bgDiv.style.backgroundImage = `url(${tweet.avatarUrl})`;
        }

        const img = avatarLink.querySelector('img') as HTMLImageElement;
        if (img) {
            img.src = tweet.avatarUrl;
            img.alt = `${tweet.displayName} avatar`;
        }
    }
}

function updateTweetProfile(container: Element, tweet: TweetObj): void {
    const userNameContainer = container.querySelector('[data-testid="User-Name"]') as HTMLElement;
    if (!userNameContainer) return;

    updateProfileLink(userNameContainer, tweet);
    updateUserMetaInfo(userNameContainer, tweet);
}

function updateProfileLink(userNameContainer: Element, tweet: TweetObj): void {
    const profileLink = userNameContainer.querySelector('a[href^="/"]') as HTMLAnchorElement;
    if (!profileLink) return;

    profileLink.href = `/${tweet.userScreenName}`;

    const displayNameSpan = profileLink.querySelector('span') as HTMLSpanElement;
    if (displayNameSpan) {
        displayNameSpan.textContent = tweet.displayName;
    }

    const bgDiv = profileLink.querySelector<HTMLElement>('div[style*="background-image"]');
    if (bgDiv) {
        bgDiv.style.backgroundImage = `url("${tweet.profileAvatarUrl}")`;
    }

    const img = profileLink.querySelector<HTMLImageElement>('img');
    if (img) {
        img.src = tweet.profileAvatarUrl;
        img.alt = `${tweet.displayName} avatar`;
    }

    const verifiedIcon = profileLink.querySelector('[data-testid="icon-verified"]')?.parentElement?.parentElement;
    if (verifiedIcon) {
        const svgContent = getVerifiedSVG(tweet.verifiedType ?? "");
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
        atLink.href = `/${tweet.userScreenName}`;
        const atSpan = atLink.querySelector('span');
        if (atSpan) {
            atSpan.textContent = `@${tweet.userScreenName}`;
        }
    }

    // 2️⃣ 推文时间链接和时间文本
    const timeLink = userMetaBlock.querySelector('a[href*="/status/"]') as HTMLAnchorElement | null;
    if (timeLink) {
        timeLink.href = `/${tweet.userScreenName}/status/${tweet.id}`;
        const timeTag = timeLink.querySelector('time');
        if (timeTag) {
            const isoDate = new Date(tweet.createdAt).toISOString();
            timeTag.setAttribute('datetime', isoDate);
            timeTag.textContent = formatTweetDate(tweet.createdAt); // 比如 "4月22日"
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

function updateTweetText(container: Element, tweet: TweetObj): void {
    const textBlock = container.querySelector('[data-testid="tweetText"]') as HTMLElement;
    if (!textBlock) return;

    // 可选：设置语言
    if (tweet.lang) {
        textBlock.setAttribute('lang', tweet.lang);
    }

    // 设置文本内容
    const span = textBlock.querySelector('span');
    if (span) {
        span.textContent = tweet.text;
    }
}
