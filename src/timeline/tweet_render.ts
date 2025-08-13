import {EntryObj, TweetAuthor, TweetCard, TweetContent, TweetMediaEntity, TweetObj} from "./tweet_entry";
import {formatCount, formatTweetTime} from "../common/utils";

import {videoRender} from "./video_render";
import {setTweetCatFlag} from "./route_helper";
import {updateTweetContentArea} from "./content_render";

export function renderTweetHTML(tweetEntry: EntryObj, tpl: HTMLTemplateElement): HTMLElement {
    const tweetCellDiv = tpl.content.getElementById("tweeCatCellDiv")!.cloneNode(true) as HTMLDivElement;
    tweetCellDiv.removeAttribute('id')
    tweetCellDiv.style.overflowAnchor = 'none';

    const article = tweetCellDiv.querySelector('article');
    if (!article) return tweetCellDiv;

    const outer = tweetEntry.tweet;
    const target = outer.renderTarget;

    updateTweetAvatar(article.querySelector(".kol-avatar-area") as HTMLElement,
        target.author);

    updateTweetTopButtonArea(article.querySelector(".tweet-header-meta") as HTMLElement,
        target.author,
        target.tweetContent.created_at,
        target.rest_id);

    // 3. 若是转推 ➔ 在顶部插入 “@outer.author.displayName reposted”
    if (outer.retweetedStatus) {
        insertRepostedBanner(article.querySelector(".tweet-topmargin") as HTMLElement, outer.author); // 你自己的函数
    }
    console.log("-----------------------》》》》引用推文对象：", target.quotedStatus);

    // ✅ 新增：收集“需要隐藏的短链”——当前只需要卡片短链
    const extraHiddenShortUrls = collectCardShortUrls(target);

    // ✅ 传入隐藏集合
    updateTweetContentArea(
        article.querySelector(".tweet-body") as HTMLElement,
        target.tweetContent,
        {hiddenShortUrls: extraHiddenShortUrls}
    );

    updateTweetMediaArea(article.querySelector(".tweet-media-area") as HTMLElement,
        target.tweetContent, tpl);

    if (target.card) {
        updateTweetCardArea(article.querySelector(".tweet-card-area") as HTMLElement,
            target.card);
    }

    const quoteArea = article.querySelector(".tweet-quote-area") as HTMLElement | null;
    if (quoteArea) {
        quoteArea.innerHTML = '';
        if (target.quotedStatus) {
            updateTweetQuoteArea(quoteArea, target.quotedStatus);
        }
    }

    updateTweetBottomButtons(article.querySelector(".tweet-actions") as HTMLElement,
        target.tweetContent, target.author.screenName, target.views_count);

    return tweetCellDiv;
}


// 渲染头像模块
export function updateTweetAvatar(avatarArea: Element, author: TweetAuthor): void {
    // const highResUrl = getHighResAvatarUrl(author.legacy.profile_image_url_https);
    const highResUrl = author.avatarImgUrl;

    const img = avatarArea.querySelector('img.avatar') as HTMLImageElement;
    if (img) {
        img.src = highResUrl;
        img.alt = author.displayName;
    }

    const link = avatarArea.querySelector('a') as HTMLAnchorElement;
    if (link) {
        link.href = `/${author.screenName}`;
    }
}

export function updateTweetTopButtonArea(headerMeta: Element, author: TweetAuthor, createdAt: string, tweetId: string): void {

    const screenNamePath = `/${author.screenName}`;
    const tweetPath = `/${author.screenName}/status/${tweetId}`;

    // 昵称（大号）区域
    const screenNameLink = headerMeta.querySelector('.display-name-link') as HTMLAnchorElement;
    if (screenNameLink) {
        bindTwitterInternalLink(screenNameLink, screenNamePath);
        const nameSpan = screenNameLink.querySelector('.tweet-author');
        if (nameSpan) nameSpan.textContent = author.displayName;
    }

    // 小号 (@xxx)
    const userNameLink = headerMeta.querySelector('.user-name-link') as HTMLAnchorElement;
    if (userNameLink) {
        bindTwitterInternalLink(userNameLink, screenNamePath);
        const screenNameSpan = userNameLink.querySelector('.tweet-username');
        if (screenNameSpan) screenNameSpan.textContent = `@${author.screenName}`;
    }

    // 时间链接
    const timeLink = headerMeta.querySelector('.tweet-time-link') as HTMLAnchorElement;
    if (timeLink) {
        bindTwitterInternalLink(timeLink, tweetPath);
        const date = new Date(createdAt);
        const timeElement = timeLink.querySelector('.tweet-time');
        if (timeElement) {
            timeElement.setAttribute('datetime', date.toISOString());
            timeElement.textContent = formatTweetTime(createdAt);
        }
    }

    // 认证图标隐藏
    const verifiedIcon = headerMeta.querySelector('.verified-box') as HTMLElement;
    if (verifiedIcon && !author.is_blue_verified) {
        verifiedIcon.style.display = 'none';
    }
}

export function insertRepostedBanner(
    banner: HTMLElement,
    author: TweetAuthor,
): void {
    const container = banner.querySelector(".tweet-topmargin-container") as HTMLElement;
    container.style.display = 'block';
    const a = banner.querySelector('a.retweet-link') as HTMLAnchorElement | null;
    if (a) {
        bindTwitterInternalLink(a, `/${author.screenName}`)
    }
    const disp = banner.querySelector('.retweeter-name');
    if (disp) disp.textContent = author.displayName;
}

export function updateTweetMediaArea(
    container: HTMLElement,
    tweetContent: TweetContent,
    tpl: HTMLTemplateElement,
): void {
    /** Tweet.media 列表（优先 extended_entities.media，没有就回退到 entities.media） */
    const mediaList: TweetMediaEntity[] =
        tweetContent.extended_entities?.media?.length
            ? tweetContent.extended_entities.media
            : tweetContent.entities?.media || [];

    if (!mediaList.length) return; // 无媒体

    container.classList.add(`count-${mediaList.length}`)

    const photos = mediaList.filter(m => m.type === 'photo');
    const videos = mediaList.filter(m => m.type === 'video' || m.type === 'animated_gif');

    if (photos.length === 0) {
        container.append(videoRender(videos[0], tpl));
        return;
    }

    if (photos.length === 3) {
        renderThreePhoto(container, photos, tpl)
    } else {
        renderMultiPhotoGroup(container, photos, tpl)
    }

    switch (photos.length) {
        case 1:
            container.classList.add('single-image');
            break;
        case 2:
            container.classList.add('two-images');
            break;
        case 3:
            container.classList.add('three-images');
            break;
        case 4:
            container.classList.add('four-images');
            break;
    }
}

function renderThreePhoto(container: HTMLElement,
                          media: TweetMediaEntity[],
                          tpl: HTMLTemplateElement) {

    const wrapper = tpl.content
        .getElementById('media-multi-image-3')!
        .cloneNode(true) as HTMLElement;
    wrapper.removeAttribute('id');

    const imgItemTpl = tpl.content.getElementById('media-image-template')?.cloneNode(true) as HTMLElement;
    imgItemTpl.removeAttribute('id');

    let item = imgItemTpl.cloneNode(true) as HTMLElement;
    replacePhotoItem(item, media[0]);
    wrapper.querySelector(".left-photo")?.appendChild(item);

    item = imgItemTpl.cloneNode(true) as HTMLElement;
    replacePhotoItem(item, media[1]);
    let backDiv = item.querySelector(".tweetPhotoBackImg") as HTMLElement;
    backDiv.style.height = '100%';

    wrapper.querySelector(".right-photo")?.appendChild(item);

    item = imgItemTpl.cloneNode(true) as HTMLElement;
    replacePhotoItem(item, media[2]);
    backDiv = item.querySelector(".tweetPhotoBackImg") as HTMLElement;
    backDiv.style.height = '100%';

    wrapper.querySelector(".right-photo")?.appendChild(item);

    container.innerHTML = wrapper.innerHTML;
}

function replacePhotoItem(item: HTMLElement, media: TweetMediaEntity) {
    const bg = item.querySelector('.tweetPhotoBackImg') as HTMLElement;
    const img = item.querySelector('.tweetPhotoImg') as HTMLImageElement;
    if (bg) bg.style.backgroundImage = `url('${media.media_url_https}')`;
    if (img) img.src = media.media_url_https;

    const link = item.querySelector('a') as HTMLAnchorElement;
    if (link && media.expanded_url) {
        link.href = media.expanded_url;
        bindTwitterInternalLink(link, media.expanded_url)
    }
}

function renderMultiPhotoGroup(container: HTMLElement,
                               medias: TweetMediaEntity[],
                               tpl: HTMLTemplateElement) {

    for (let i = 0; i < medias.length; i++) {
        const item = tpl.content.getElementById('media-image-template')?.cloneNode(true) as HTMLElement;
        item.removeAttribute('id');
        replacePhotoItem(item, medias[i]);
        container.appendChild(item);
    }
}

function updateTweetBottomButtons(
    container: HTMLElement,
    tweetContent: TweetContent,
    screenName: string,
    viewsCount: number | undefined,
): void {
    const reply = container.querySelector('.replyNo .count');
    const retweet = container.querySelector('.retweetNo .count');
    const like = container.querySelector('.likeNo .count');
    const views = container.querySelector('.viewNo .count');
    const viewsLink = container.querySelector('.viewLink') as HTMLAnchorElement | null;

    reply && (reply.textContent = formatCount(tweetContent.reply_count).toLocaleString() ?? '');
    retweet && (retweet.textContent = formatCount(tweetContent.retweet_count + tweetContent.quote_count).toLocaleString() ?? '');
    like && (like.textContent = formatCount(tweetContent.favorite_count).toLocaleString() ?? '');
    views && (views.textContent = formatCount(viewsCount ?? 0).toLocaleString() ?? '');

    if (viewsLink) {
        viewsLink.href = `/${screenName}/status/${tweetContent.id_str}/analytics`;
    }
}


function bindTwitterInternalLink(element: HTMLAnchorElement, path: string) {
    if (element.dataset.hasProtected === 'true') return;

    element.href = path;
    element.addEventListener('click', (e) => {
        // 避免修饰键（如 Ctrl+Click / Cmd+Click）破坏行为
        if (
            e.defaultPrevented ||
            e.button !== 0 || // 非左键点击
            e.metaKey || e.ctrlKey || e.shiftKey || e.altKey
        ) return;

        // console.log("-------------->>>>>>", element, path)
        e.preventDefault();
        setTweetCatFlag(true);
        history.pushState({fromTweetCat: true}, '', path);
        dispatchEvent(new PopStateEvent('popstate'));
    });
    element.dataset.hasProtected = 'true';
}

function collectCardShortUrls(target: { card: { url?: string } | null }): string[] {
    const list: string[] = [];
    const tco = target.card?.url;     // 来自 TweetCard.binding_values.card_url
    if (tco) list.push(tco);
    return list;
}


function normalizeUrl(u?: string): string | undefined {
    if (!u) return;
    // 已经有协议
    if (/^https?:\/\//i.test(u)) return u;
    return `https://${u}`;
}

function updateTweetCardArea(
    container: HTMLElement,
    card: TweetCard | null,
    _tpl?: HTMLTemplateElement,
): void {
    if (!container) return;
    container.innerHTML = "";
    if (!card) return;

    const hrefTco = card.url || card.vanityUrl || "#";          // 点击走 t.co（与官方一致）
    const expanded = normalizeUrl(card.vanityUrl) || undefined; // 作为 data-expanded-url

    const title = card.title || card.domain || card.vanityUrl || "";
    const desc = card.description || "";
    const thumb = card.mainImageUrl;
    const domainText = card.domain?.replace(/^https?:\/\//, "");

    const a = document.createElement("a");
    a.className = "inline-link inline-link-card";
    a.href = hrefTco;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    if (title) a.title = title;
    if (expanded) a.dataset.expandedUrl = expanded;

    if (thumb) {
        const thumbWrap = document.createElement("div");
        thumbWrap.className = "thumb";
        const img = document.createElement("img");
        img.src = thumb;
        img.loading = "lazy";
        img.alt = title || domainText || "link";
        thumbWrap.appendChild(img);
        a.appendChild(thumbWrap);
    }

    const meta = document.createElement("div");
    meta.className = "meta";

    const titleDiv = document.createElement("div");
    titleDiv.className = "title";
    titleDiv.textContent = title || (card.vanityUrl ?? "");
    meta.appendChild(titleDiv);

    if (desc) {
        const descDiv = document.createElement("div");
        descDiv.className = "desc";
        descDiv.textContent = desc;
        meta.appendChild(descDiv);
    }

    if (domainText) {
        const domainDiv = document.createElement("div");
        domainDiv.className = "desc";
        domainDiv.textContent = domainText;
        meta.appendChild(domainDiv);
    }

    a.appendChild(meta);
    container.appendChild(a);
}


// —— 辅助：识别 twitter/x 的 status 链接（expanded_url）
function isTwitterStatusUrl(href: string | undefined): boolean {
    if (!href) return false;
    try {
        const u = new URL(href);
        const host = u.hostname.toLowerCase();
        if (host !== 'twitter.com' && host !== 'www.twitter.com' &&
            host !== 'x.com' && host !== 'www.x.com') return false;
        return /\/[^/]+\/status\/\d+/.test(u.pathname);
    } catch {
        return false;
    }
}

// —— 从当前“主推文”的 entities 里找出“引用短链”的 t.co（用于隐藏）
//    思路：当存在 quotedStatus 时，正文末尾通常有一条指向 /status/ 的 url；
//    我们把这条 url 的短链（u.url）加入隐藏集合即可。
function collectQuoteShortUrlsForMain(tweet: TweetContent, hasQuoted: boolean): string[] {
    if (!hasQuoted) return [];
    const arr = tweet.entities?.urls ?? [];
    const hit = arr.filter(u => isTwitterStatusUrl(u.expanded_url));
    return hit.map(u => u.url).filter(Boolean);
}

// —— 渲染“简版引用卡”（只作者+文本，不渲染媒体/卡片）
function updateTweetQuoteArea(container: HTMLElement, quoted: TweetObj) {
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
