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
    updateTweetTopButtonArea(articleContainer, tweetEntry.tweet.author, tweetEntry.tweet.tweetContent.created_at, contentTemplate);
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
export function updateTweetTopButtonArea(container: Element, author: TweetAuthor, createdAt: string, contentTemplate: HTMLTemplateElement): void {
    const topButtonTemplate = contentTemplate.content.getElementById('top-button-area-template') as HTMLElement;
    if (!topButtonTemplate) return;

    const topButtonClone = topButtonTemplate.cloneNode(true) as HTMLElement;
    topButtonClone.removeAttribute('id');

    const userNameLink = topButtonClone.querySelector('[data-testid="User-Name"] a') as HTMLAnchorElement;
    if (userNameLink) {
        userNameLink.href = `/${author.legacy.screenName}`;
        const nameSpan = userNameLink.querySelector('span span');
        if (nameSpan) {
            nameSpan.textContent = author.legacy.displayName;
        }
    }

    const screenNameLink = topButtonClone.querySelector('a[href*="@"]') as HTMLAnchorElement;
    if (screenNameLink) {
        screenNameLink.href = `/${author.legacy.screenName}`;
        const screenNameSpan = screenNameLink.querySelector('span');
        if (screenNameSpan) {
            screenNameSpan.textContent = `@${author.legacy.screenName}`;
        }
    }

    const timeLink = topButtonClone.querySelector('a[href*="/status/"]') as HTMLAnchorElement;
    if (timeLink) {
        const date = new Date(createdAt);
        timeLink.querySelector('time')?.setAttribute('datetime', date.toISOString());
        timeLink.querySelector('time')!.textContent = `${date.getMonth() + 1}月${date.getDate()}日`;
    }

    const topArea = container.querySelector(".Tweet-Body .top-button-area");
    if (topArea) {
        topArea.innerHTML = topButtonClone.innerHTML;
    }
}
