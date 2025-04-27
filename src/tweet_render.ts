import {EntryObj, TweetAuthor, TweetContent} from "./object_tweet";



export function renderTweetsBatch(entries: EntryObj[], contentTemplate: HTMLTemplateElement): DocumentFragment {
    const fragment = document.createDocumentFragment();

    entries.forEach((entry, index) => {
        const tweetNode = renderTweetHTML(index, entry, contentTemplate);
        fragment.appendChild(tweetNode);
    });

    return fragment;
}

export function renderTweetHTML(index: number, tweetEntry: EntryObj, contentTemplate: HTMLTemplateElement, estimatedHeight: number = 350): HTMLElement {
    const tweetCellDiv = contentTemplate.content.getElementById("tweetCellTemplate")!.cloneNode(true) as HTMLDivElement;
    tweetCellDiv.style.transform = `translateY(${index * estimatedHeight}px)`;
    tweetCellDiv.setAttribute('id', "");

    const articleContainer = tweetCellDiv.querySelector('article[data-testid="tweet"]');
    if (!articleContainer) return tweetCellDiv;

    updateTweetAvatar(articleContainer, tweetEntry.tweet.author, contentTemplate);
    updateTweetTopButtonArea(articleContainer, tweetEntry.tweet.author, tweetEntry.tweet.tweetContent.created_at, tweetEntry.tweet.rest_id, contentTemplate);
    return tweetCellDiv;
}

// 工具函数：获取高清头像链接
function getHighResAvatarUrl(url: string): string {
    return url.replace('_normal', '_400x400');
}

// 渲染头像模块
export function updateTweetAvatar(container: Element, author: TweetAuthor, contentTemplate: HTMLTemplateElement): void {
    const avatarTemplate = contentTemplate.content.getElementById('Tweet-User-Avatar') as HTMLElement;
    if (!avatarTemplate) return;

    const avatarClone = avatarTemplate.cloneNode(true) as HTMLElement;
    avatarClone.removeAttribute('id');

    const highResUrl = getHighResAvatarUrl(author.legacy.profile_image_url_https);

    const img = avatarClone.querySelector('img') as HTMLImageElement;
    if (img) {
        img.src = highResUrl;
        img.alt = author.legacy.displayName;
    }

    const bgDiv = avatarClone.querySelector('div[style*="background-image"]') as HTMLDivElement;
    if (bgDiv) {
        bgDiv.style.backgroundImage = `url(${highResUrl})`;
    }

    const link = avatarClone.querySelector('a') as HTMLAnchorElement;
    if (link) {
        link.href = `/${author.legacy.screenName}`;
    }

    const wrapper = avatarClone.querySelector('[data-testid^="UserAvatar-Container"]');
    if (wrapper) {
        wrapper.setAttribute('data-testid', `UserAvatar-Container-${author.legacy.screenName}`);
    }

    const avatarContainer = container.querySelector(".Tweet-User-Avatar");
    if (avatarContainer) {
        avatarContainer.innerHTML = '';
        avatarContainer.appendChild(avatarClone);
    }
}


// 渲染顶部昵称、用户名、发布时间区域
export function updateTweetTopButtonArea(container: Element, author: TweetAuthor, createdAt: string, tweetId: string, contentTemplate: HTMLTemplateElement): void {
    const topButtonTemplate = contentTemplate.content.getElementById('top-button-area-template') as HTMLElement;
    if (!topButtonTemplate) return;

    const topButtonClone = topButtonTemplate.cloneNode(true) as HTMLElement;
    topButtonClone.removeAttribute('id');

    // 更新昵称（大号）区域
    const userNameLink = topButtonClone.querySelector('[data-testid="User-Name"] a') as HTMLAnchorElement;
    if (userNameLink) {
        userNameLink.href = `/${author.legacy.screenName}`;
        const nameSpan = userNameLink.querySelector('span span');
        if (nameSpan) nameSpan.textContent = author.legacy.displayName;
    }

    // 更新小号 (@xxx)
    const screenNameLink = topButtonClone.querySelector('a[tabindex="-1"]') as HTMLAnchorElement;
    if (screenNameLink) {
        screenNameLink.href = `/${author.legacy.screenName}`;
        const screenNameSpan = screenNameLink.querySelector('span');
        if (screenNameSpan) screenNameSpan.textContent = `@${author.legacy.screenName}`;
    }

    // 更新时间
    const timeLink = topButtonClone.querySelector('a[href*="/status/"]') as HTMLAnchorElement;
    if (timeLink) {
        timeLink.href = `/${author.legacy.screenName}/status/${tweetId}`;
        const date = new Date(createdAt);
        const timeElement = timeLink.querySelector('time');
        if (timeElement) {
            timeElement.setAttribute('datetime', date.toISOString());
            timeElement.textContent = formatTweetTime(createdAt);
        }
    }

    // 动态处理认证图标是否显示
    const verifiedIcon = topButtonClone.querySelector('svg[data-testid="icon-verified"]');
    if (verifiedIcon && !author.is_blue_verified) {
        verifiedIcon.remove();
    }

    // 安全赋值内容
    const topArea = container.querySelector(".Tweet-Body .top-button-area");
    if (topArea) {
        topArea.innerHTML = '';
        topArea.appendChild(topButtonClone);
    }
}


function formatTweetTime(dateString: string, locale: 'auto' | 'zh' | 'en' = 'auto'): string {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);

    let finalLocale = locale;
    if (locale === 'auto') {
        const lang = navigator.language.toLowerCase();
        finalLocale = lang.startsWith('zh') ? 'zh' : 'en';
    }

    if (diffSeconds < 60) {
        return finalLocale === 'zh' ? `${diffSeconds}秒前` : `${diffSeconds}s ago`;
    } else if (diffMinutes < 60) {
        return finalLocale === 'zh' ? `${diffMinutes}分钟前` : `${diffMinutes}m ago`;
    } else if (diffHours < 24) {
        return finalLocale === 'zh' ? `${diffHours}小时前` : `${diffHours}h ago`;
    } else {
        if (finalLocale === 'zh') {
            return `${date.getMonth() + 1}月${date.getDate()}日`;
        } else {
            return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        }
    }
}
