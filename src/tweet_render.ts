import {EntryObj, TweetAuthor, TweetContent} from "./object_tweet";

export function renderTweetHTML(index: number, tweetEntry: EntryObj, contentTemplate: HTMLTemplateElement, estimatedHeight: number = 350): HTMLElement {
    const tweetCellDiv = contentTemplate.content.getElementById("tweetCellTemplate")!.cloneNode(true) as HTMLDivElement;
    tweetCellDiv.style.transform = `translateY(${index * estimatedHeight}px)`;
    tweetCellDiv.setAttribute('id', "");

    const articleContainer = tweetCellDiv.querySelector('article[data-testid="tweetEntry"]');
    if (!articleContainer) return tweetCellDiv;

    updateTweetAvatar(articleContainer, tweetEntry.tweet.author, contentTemplate);
    const tweetBody = articleContainer.querySelector(".Tweet-Body") as HTMLElement
    updateTweetProfile(tweetBody, tweetEntry.tweet.author, contentTemplate);
    updateTweetText(tweetBody, tweetEntry.tweet.tweetContent, contentTemplate);
    updateTweetMedia(tweetBody, tweetEntry, contentTemplate);
    updateTweetOperationBar(tweetBody, tweetEntry, contentTemplate);

    return tweetCellDiv;
}


function updateTweetAvatar(container: Element, author: TweetAuthor, contentTemplate: HTMLTemplateElement): void {
    const avatarContainer = contentTemplate.content.getElementById('Tweet-User-Avatar')!.cloneNode(true) as HTMLElement;
    if (!avatarContainer) return;
    const avatarBox = avatarContainer.querySelector('[data-testid^="UserAvatar-Container-"]') as HTMLElement;
    if (avatarBox) {
        avatarBox.setAttribute('data-testid', `UserAvatar-Container-${author.legacy.screenName}`);
    }

    const avatarLink = avatarContainer.querySelector('a[href^="/"]') as HTMLAnchorElement;
    if (avatarLink) {
        avatarLink.href = `/${author.legacy.screenName}`;

        const bgDiv = avatarLink.querySelector('div[style*="background-image"]') as HTMLElement;
        if (bgDiv) {
            bgDiv.style.backgroundImage = `url(${author.legacy.profile_image_url_https})`;
        }

        const img = avatarLink.querySelector('img') as HTMLImageElement;
        if (img) {
            img.src = author.legacy.profile_image_url_https;
            img.alt = `${author.legacy.displayName} avatar`;
        }
    }

    container.querySelector(".Tweet-User-Avatar")!.appendChild(avatarContainer);
}

function updateTweetProfile(tweetBody: Element, author: TweetAuthor, contentTemplate: HTMLTemplateElement): void {
    const topButtonDiv = contentTemplate.content.getElementById('top-button-area')!.cloneNode(true) as HTMLElement;

    const userNameContainer = topButtonDiv.querySelector('[data-testid="User-Name"]') as HTMLElement;
    if (!userNameContainer) return;

    updateProfileLink(userNameContainer, author);
    updateUserMetaInfo(userNameContainer, author);

    tweetBody.append(topButtonDiv);
}

function updateProfileLink(userNameContainer: Element, author: TweetAuthor): void {
    const profileLink = userNameContainer.querySelector('a[href^="/"]') as HTMLAnchorElement;
    if (!profileLink) return;

    profileLink.href = `/${author.legacy.screenName}`;

    const displayNameSpan = profileLink.querySelector('span') as HTMLSpanElement;
    if (displayNameSpan) {
        displayNameSpan.textContent = author.legacy.displayName;
    }

    const bgDiv = profileLink.querySelector<HTMLElement>('div[style*="background-image"]');
    if (bgDiv) {
        bgDiv.style.backgroundImage = `url("${author.legacy.profile_image_url_https}")`;
    }

    const img = profileLink.querySelector<HTMLImageElement>('img');
    if (img) {
        img.src = author.legacy.profile_image_url_https;
        img.alt = `${author.legacy.displayName} avatar`;
    }

    const verifiedIcon = profileLink.querySelector('[data-testid="icon-verified"]')?.parentElement?.parentElement;
    if (verifiedIcon) {
        if (author.is_blue_verified) {
            verifiedIcon.style.display = '';
            verifiedIcon.innerHTML = getVerifiedSVG('blue');
        } else {
            verifiedIcon.style.display = 'none';
        }
        // const svgContent = getVerifiedSVG(author.legacy.verifiedType ?? "");
        // if (svgContent) {
        //     verifiedIcon.innerHTML = svgContent;
        //     verifiedIcon.style.display = '';
        // } else {
        //     verifiedIcon.style.display = 'none';
        // }
    }
}

function updateUserMetaInfo(userNameContainer: HTMLElement, author: TweetAuthor) {
    const userMetaBlock = userNameContainer.querySelectorAll(':scope > div')[1]; // 第二个直接子 div
    if (!userMetaBlock) return;

    // 1️⃣ @elonmusk 的链接和文字
    const atLink = userMetaBlock.querySelector('a[role="link"][tabindex="-1"]') as HTMLAnchorElement | null;
    if (atLink) {
        atLink.href = `/${author.legacy.screenName}`;
        const atSpan = atLink.querySelector('span');
        if (atSpan) {
            atSpan.textContent = `@${author.legacy.screenName}`;
        }
    }
    const content = tweet.content.itemContent.tweet_results.legacy;

    // 2️⃣ 推文时间链接和时间文本
    const timeLink = userMetaBlock.querySelector('a[href*="/status/"]') as HTMLAnchorElement | null;
    if (timeLink) {
        timeLink.href = `/${author.legacy.screenName}/status/${tweet.content.itemContent.tweet_results.rest_id}`;
        const timeTag = timeLink.querySelector('time');
        if (timeTag) {
            const isoDate = new Date(content.created_at).toISOString();
            timeTag.setAttribute('datetime', isoDate);
            timeTag.textContent = formatTweetDate(content.created_at);
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

function updateTweetText(tweetBody: Element, content: TweetContent, contentTemplate: HTMLTemplateElement): void {
    const textArea = contentTemplate.content.getElementById('tweet-text-area')!.cloneNode(true) as HTMLElement;

    const textBlock = textArea.querySelector('[data-testid="tweetText"]') as HTMLElement;
    if (!textBlock) return;


    if (content.lang) {
        textBlock.setAttribute('lang', content.lang);
    }

    const span = textBlock.querySelector('span');
    if (span) {
        span.textContent = content.fullText;
    }

    tweetBody.append(textArea);
}

function updateTweetMedia(tweetBody: Element, tweet: EntryObj, contentTemplate: HTMLTemplateElement): void {
    if (tweet.mediaEntities.length === 0) {
        return;
    }
    //TODO::different tweet obj with different media data
}

function formatCount(count: number): string {
    if (count >= 1_000_000) return (count / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (count >= 1_000) return (count / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
    return count.toString();
}

function buttonWithData(btn: HTMLElement, no: number) {
    if (!btn) {
        return
    }
    const countSpan = btn.querySelector('[data-testid="app-text-transition-container"] span span');
    if (countSpan) {
        countSpan.textContent = formatCount(no);
    }
}

function updateTweetOperationBar(tweetBody: Element, tweet: EntryObj, contentTemplate: HTMLTemplateElement): void {
    const bottomBtnDiv = contentTemplate.content.getElementById('bottom-button-area')!.cloneNode(true) as HTMLElement;

    const replyButton = bottomBtnDiv.querySelector('button[data-testid="reply"]') as HTMLElement;
    buttonWithData(replyButton, tweet.stats.tweetReplies);

    const retweetButton = bottomBtnDiv.querySelector('button[data-testid="retweet"]') as HTMLElement;
    buttonWithData(retweetButton, tweet.stats.tweetRetweets);

    const likeButton = bottomBtnDiv.querySelector('button[data-testid="like"]') as HTMLElement;
    buttonWithData(likeButton, tweet.stats.tweetLikes);

    const viewLink = bottomBtnDiv.querySelector('a[href*="/analytics"]') as HTMLAnchorElement;
    viewLink.href = `/${tweet.author.screenName}/status/${tweet.content.id}/analytics`;
    buttonWithData(viewLink, tweet.stats.tweetViews);

    const bookMark = bottomBtnDiv.querySelector('button[data-testid="bookmark"]') as HTMLElement;
    bookMark.onclick = () => {
        console.log("-------->>> book mark button click");
    }

    tweetBody.append(bottomBtnDiv);
}
