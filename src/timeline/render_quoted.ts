import {TweetContent, TweetObj} from "./tweet_entry";
import {bindTwitterInternalLink, isTwitterStatusUrl} from "./render_common";
import {updateTweetContentArea} from "./render_content";

function collectQuoteShortUrlsForMain(tweet: TweetContent, hasQuoted: boolean): string[] {
    if (!hasQuoted) return [];
    const arr = tweet.entities?.urls ?? [];
    const hit = arr.filter(u => isTwitterStatusUrl(u.expanded_url));
    return hit.map(u => u.url).filter(Boolean);
}

// —— 渲染“简版引用卡”（只作者+文本，不渲染媒体/卡片）
export function updateTweetQuoteArea(container: HTMLElement, quoted: TweetObj) {
    // 清空容器
    container.innerHTML = '';

    // 外层卡片（整块可点击）
    const a = document.createElement('a');
    a.className = 'quote-card';
    a.href = `/${quoted.author.screenName}/status/${quoted.tweetContent.id_str}`;
    // 走你现有的内部路由
    try {
        bindTwitterInternalLink(a, a.href);
    } catch {
    }

    // 头部：头像 + 昵称 + @handle
    const header = document.createElement('div');
    header.className = 'quote-header';

    const av = document.createElement('img');
    av.className = 'avatar small';
    av.src = quoted.author.avatarImgUrl;
    av.alt = quoted.author.displayName;

    const meta = document.createElement('div');
    meta.className = 'quote-author';
    const dn = document.createElement('span');
    dn.className = 'display-name';
    dn.textContent = quoted.author.displayName;
    const hd = document.createElement('span');
    hd.className = 'handle';
    hd.textContent = `@${quoted.author.screenName}`;
    meta.appendChild(dn);
    meta.appendChild(hd);

    header.appendChild(av);
    header.appendChild(meta);

    // 正文：只文本（含实体高亮），不渲染媒体/卡片（下一步再加）
    const body = document.createElement('div');
    body.className = 'quote-body';
    const inner = document.createElement('div');
    inner.className = 'tweet-content';
    body.appendChild(inner);

    // 这里复用你已有的内容渲染逻辑（不传隐藏集合，引用内容不用吞“引用短链”）
    updateTweetContentArea(body as unknown as HTMLElement, quoted.tweetContent);

    a.appendChild(header);
    a.appendChild(body);
    container.appendChild(a);
}

