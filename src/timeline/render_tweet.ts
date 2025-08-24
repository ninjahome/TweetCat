import {EntryObj, TweetAuthor, TweetContent, TweetMediaEntity, TweetObj} from "./tweet_entry";
import {formatTweetTime, isXArticle} from "../common/utils";
import {videoRender} from "./render_video";
import {updateTweetContentArea} from "./render_content";
import {updateTweetQuoteArea} from "./render_quoted";
import {updateTweetCardArea} from "./render_card";
import {bindTwitterInternalLink} from "./render_common";
import {updateTweetBottomButtons} from "./render_action";

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

    // console.log("tweet contents", JSON.stringify(target.tweetContent));
    const extraHiddenShortUrls = collectExtraHiddenShortUrls(target.card);

    updateTweetContentArea(
        article.querySelector(".tweet-content-container") as HTMLElement,
        target.tweetContent,
        {hiddenShortUrls: extraHiddenShortUrls, hasMore: target.hasNoteExpandable}
    );

    const mediaArea = article.querySelector(".tweet-media-area") as HTMLElement;
    updateTweetMediaArea(mediaArea, target.tweetContent, tpl);

    wireMediaAnchors(article, target.author, target.rest_id, target.tweetContent?.extended_entities?.media ?? []);

    if (target.card) {
        updateTweetCardArea(article.querySelector(".tweet-card-area") as HTMLElement,
            target.card, tpl);
    }
    wireCardAnchor(article, target.author, target.rest_id);

    const quoteArea = article.querySelector(".tweet-quote-area") as HTMLElement | null;
    if (quoteArea) {
        quoteArea.innerHTML = '';
        if (target.quotedStatus) {
            updateTweetQuoteArea(quoteArea, target.quotedStatus, tpl, hasMainMediaOrCard(target));
        }
    }

    const videoWrapper = mediaArea.querySelector(".video-wrapper") as HTMLElement;
    const mp4List: string[] = JSON.parse(videoWrapper?.dataset.mp4List ?? '[]');
    const tweetCatActionArea = article.querySelector(".tweet-actions") as HTMLElement;

    updateTweetBottomButtons(tweetCatActionArea, target, mp4List);

    attachBodyPermalink(article, target.author, target.rest_id);

    return tweetCellDiv;
}

function hasMainMediaOrCard(t: TweetObj): boolean {
    const hasMedia = !!t.tweetContent?.extended_entities?.media?.length;
    const hasCard = !!t.card;
    return hasMedia || hasCard;
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

function wireMediaAnchors(
    article: Element,
    author: { screenName: string },
    tweetId: string,
    mediaList: Array<{ type: string }> = []
): void {
    const area = article.querySelector('.tweet-media-area'); // 只改本条 tweet 的媒体区
    if (!area) return;

    const links = Array.from(area.querySelectorAll<HTMLAnchorElement>('a'));
    links.forEach((a, i) => {
        const m = mediaList[i];
        const seg = m?.type === 'photo' ? 'photo' : 'video';
        const idx = seg === 'photo' ? (i + 1) : 1;
        const path = `/${author.screenName}/status/${tweetId}/${seg}/${idx}`;

        a.href = path;
        a.removeAttribute('target');
        a.dataset.noDetail = '1';
        a.dataset.mediaIndex = String(idx);
        a.dataset.mediaType = seg;

        // 绑定内部路由（如有）
        // @ts-ignore
        if (typeof bindTwitterInternalLink === 'function') bindTwitterInternalLink(a, path);
    });
}

function wireCardAnchor(
    article: Element,
    author: { screenName: string },
    tweetId: string
): void {
    const a = article.querySelector<HTMLAnchorElement>('.tweet-card-area .tc-card-large__media');
    if (!a) return;

    // renderLargeCard 已写入 data-expanded-url
    const expanded = (a as any).dataset?.expandedUrl || a.getAttribute('href') || '';
    const isInternal = isXArticle(expanded);

    if (isInternal) {
        // 站内（/i/article/...）：点击进入该推文详情（无刷新内部路由）
        const path = `/${author.screenName}/status/${tweetId}`;
        a.href = path;
        a.removeAttribute('target');
        a.dataset.noDetail = '1';
        // @ts-ignore
        if (typeof bindTwitterInternalLink === 'function') bindTwitterInternalLink(a, path);
    } else {
        // 外部链接：保持新开标签到外站（优先用 expanded，退回 a.href/t.co）
        if (expanded) a.href = expanded;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.removeAttribute('data-no-detail');
    }

    // 图下文字区域点击 => 转发到锚点
    const forward = (sel: string) => {
        const el = article.querySelector(sel);
        if (!el) return;
        el.addEventListener('click', (ev) => {
            ev.preventDefault();
            a.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true, view: window}));
        });
    };
    forward('.tc-card-large__caption');
    forward('.tc-card-large__meta');
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

    container.style.display = 'flex';
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

function collectExtraHiddenShortUrls(
    card?: { url?: string; entityUrl?: string } | null
): string[] {
    const set = new Set<string>();
    for (const u of [card?.url, (card as any)?.entityUrl]) {
        if (u && /^https?:\/\/t\.co\//i.test(u)) set.add(u);
    }
    return [...set];
}


// 新增：正文区域点击 -> 进入详情（贴近官方）
function attachBodyPermalink(article: Element, author: TweetAuthor, tweetId: string): void {
    const body = article.querySelector('.tweet-body') as HTMLElement | null;
    if (!body) return;

    // 你的时间链接已经由 updateTweetTopButtonArea 设好了，优先复用它
    const timeLink = article.querySelector('.tweet-time-link') as HTMLAnchorElement | null;

    // 备用路径（与你上面的一致：/screenName/status/id）
    const tweetPath = `/${author.screenName}/status/${tweetId}`;

    // 给主体区加“可点击”的视觉提示（可选）
    body.classList.add('is-permalink');

    body.addEventListener('click', (ev) => {
        const e = ev as MouseEvent;
        if (e.button !== 0) return; // 只响应左键

        // 正在选中文本时不跳转（贴近官方体验）
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed) return;

        const t = ev.target as HTMLElement | null;
        if (!t) return;

        // 排除所有已有交互元素：a/button/媒体/卡片/投票/引用/操作区/头像/用户名/转推条/时间等
        const exclude = [
            'a', 'button', '[role=button]',
            '.tweet-actions', '.tweet-media-area',
            '.tc-card', '.tc-card-large', '.summary-card',
            '.poll', '.poll-container', '.quoted-tweet', '.quote-tweet',
            '.avatar', '.display-name-link', '.user-name-link',
            '.retweet-link', '.tweet-time-link',
            '[data-no-detail]'
        ].join(',');
        if (t.closest(exclude)) return;

        // 走你现有的内部路由：优先触发时间链接；否则用你自己的相对路径
        if (timeLink) {
            timeLink.click();
        } else {
            // 如果你项目里有 bindTwitterInternalLink 的“内部跳转”工具，也可以创建个临时 <a> 用它绑定后 .click()
            window.open(tweetPath, '_blank', 'noopener,noreferrer');
        }
    });

    // 无障碍：让主体可通过 Enter/Space 进入详情（可选，但推荐）
    body.setAttribute('role', 'link');
    body.setAttribute('tabindex', '0');
    body.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
            const active = e.target as HTMLElement;
            if (active.closest('a,button,[role=button]')) return;
            if (timeLink) timeLink.click(); else window.open(tweetPath, '_blank', 'noopener,noreferrer');
            e.preventDefault();
        }
    });
}

