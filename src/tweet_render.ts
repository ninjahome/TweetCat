import {EntryObj, TweetAuthor, TweetContent, TweetMediaEntity} from "./object_tweet";
import {formatCount, formatTweetTime} from "./utils";

import Hls from 'hls.js';

export function renderTweetHTML(tweetEntry: EntryObj, tpl: HTMLTemplateElement): HTMLElement {
    const tweetCellDiv = tpl.content.getElementById("tweeCatCellDiv")!.cloneNode(true) as HTMLDivElement;
    tweetCellDiv.setAttribute('id', "");

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

    // 4. 正文文本 = target.tweetContent.full_text  (注意 entity 等都用 target)
    updateTweetContentArea(article.querySelector(".tweet-body") as HTMLElement, target.tweetContent);

    updateTweetMediaArea(article.querySelector(".tweet-media-area") as HTMLElement,
        target.tweetContent, tpl);

    updateTweetBottomButtons(article.querySelector(".tweet-actions") as HTMLElement,
        target.tweetContent, target.author.legacy.screenName, target.views_count);

    return tweetCellDiv;
}


// 渲染头像模块
export function updateTweetAvatar(avatarArea: Element, author: TweetAuthor): void {
    // const highResUrl = getHighResAvatarUrl(author.legacy.profile_image_url_https);
    const highResUrl = author.avatarImgUrl;

    const img = avatarArea.querySelector('img.avatar') as HTMLImageElement;
    if (img) {
        img.src = highResUrl;
        img.alt = author.legacy.displayName;
    }

    const link = avatarArea.querySelector('a') as HTMLAnchorElement;
    if (link) {
        link.href = `/${author.legacy.screenName}`;
    }
}


// 渲染顶部昵称、用户名、发布时间区域
export function updateTweetTopButtonArea(headerMeta: Element, author: TweetAuthor, createdAt: string, tweetId: string): void {

    // 更新昵称（大号）区域
    const screenNameLink = headerMeta.querySelector('.display-name-link') as HTMLAnchorElement;
    if (screenNameLink) {
        screenNameLink.href = `/${author.legacy.screenName}`;
        const nameSpan = screenNameLink.querySelector('.tweet-author');
        if (nameSpan) nameSpan.textContent = author.legacy.displayName;
    }

    // 更新小号 (@xxx)
    const userNameLink = headerMeta.querySelector('.user-name-link') as HTMLAnchorElement;
    if (userNameLink) {
        userNameLink.href = `/${author.legacy.screenName}`;
        const screenNameSpan = userNameLink.querySelector('.tweet-username');
        if (screenNameSpan) screenNameSpan.textContent = `@${author.legacy.screenName}`;
    }

    // 更新时间
    const timeLink = headerMeta.querySelector('.tweet-time-link') as HTMLAnchorElement;
    if (timeLink) {
        timeLink.href = `/${author.legacy.screenName}/status/${tweetId}`;
        const date = new Date(createdAt);
        const timeElement = timeLink.querySelector('.tweet-time');
        if (timeElement) {
            timeElement.setAttribute('datetime', date.toISOString());
            timeElement.textContent = formatTweetTime(createdAt);
        }
    }

    // 动态处理认证图标是否显示
    const verifiedIcon = headerMeta.querySelector('.verified-box') as HTMLElement;
    if (verifiedIcon && !author.is_blue_verified) {
        verifiedIcon.style.display = 'none';
    }
}

export function updateTweetContentArea(
    container: HTMLElement,
    tweet: TweetContent,
): string | undefined {

    const tweetContent = container.querySelector(".tweet-content") as HTMLElement;
    if (!tweetContent) {
        console.log("------>>> tweet content not found:", container);
        return;
    }

    /* ---------- 1. 判断是否为 Retweet ---------- */
    let repostAuthorHandle: string | undefined;
    let visible = tweet.full_text;
    const m = /^RT\s+@(\w+):\s+/u.exec(visible);
    if (m) {
        repostAuthorHandle = m[1];
        visible = visible.slice(m[0].length);
    }

    /* ---------- 2. 使用 display_text_range 裁剪 ---------- */
    const cps = [...visible];
    const [start, end] = tweet.display_text_range;
    visible = cps.slice(start, end).join('');

    /* ---------- 3. 收集 media 占位短链 ---------- */
    const mediaTco = new Set<string>();
    tweet.extended_entities?.media?.forEach(m => mediaTco.add(m.url));

    /* ---------- 4. 移除正文中的 media t.co 占位 ---------- */
    if (mediaTco.size) {
        mediaTco.forEach(u => {
            const re = new RegExp(`\\s*${escapeRegExp(u)}\\s*`, 'g');
            visible = visible.replace(re, '');
        });
    }

    /* ---------- 5. 构建实体映射 ---------- */
    type Piece = { start: number; end: number; html: string };
    const pieces: Piece[] = [];

    tweet.entities.user_mentions.forEach(u =>
        pieces.push({
            start: u.indices[0],
            end: u.indices[1],
            html: `<a href="/${u.screen_name}" class="mention">@${u.screen_name}</a>`
        }),
    );
    tweet.entities.hashtags.forEach(h =>
        pieces.push({
            start: h.indices[0],
            end: h.indices[1],
            html: `<a href="/hashtag/${h.text}" class="hashtag">#${h.text}</a>`
        }),
    );

    // URL – 过滤 media 及裸短链
    tweet.entities.urls.forEach(u => {
        if (mediaTco.has(u.url)) return; // media 占位
        const isBareTco = /^https?:\/\/t\.co\/[A-Za-z0-9]+$/u.test(u.expanded_url ?? u.url);
        if (isBareTco) return;

        pieces.push({
            start: u.indices[0],
            end: u.indices[1],
            html: `<a href="${u.expanded_url}" class="url" target="_blank" rel="noopener noreferrer">${escapeHTML(u.display_url)}</a>`,
        });
    });

    /* ---------- 6. 拼装 HTML ---------- */
    pieces.sort((a, b) => a.start - b.start);
    const out: string[] = [];
    let last = 0;
    for (const p of pieces) {
        if (last < p.start) out.push(plain(visible.slice(last, p.start)));
        out.push(p.html);
        last = p.end;
    }
    if (last < visible.length) out.push(plain(visible.slice(last)));

    tweetContent.innerHTML = out.join('');

    return repostAuthorHandle;
}

/* ---------- helpers ---------- */
function plain(txt: string): string {
    return escapeHTML(txt).replace(/\n/g, '<br>');
}

/* ---------- tiny utils ---------- */
function escapeHTML(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}


export function insertRepostedBanner(
    banner: HTMLElement,
    author: TweetAuthor,
): void {
    const container = banner.querySelector(".tweet-topmargin-container") as HTMLElement;
    container.style.display = 'block';
    const a = banner.querySelector('a.retweet-link') as HTMLAnchorElement | null;
    if (a) a.href = `/${author.legacy.screenName}`;
    const disp = banner.querySelector('.retweeter-name');
    if (disp) disp.textContent = author.legacy.displayName;
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


const videoControllers = new WeakMap<HTMLVideoElement, { observer: IntersectionObserver, hls?: Hls }>();

function videoRender(m: TweetMediaEntity, tpl: HTMLTemplateElement): HTMLElement {
    const wrapper = tpl.content
        .getElementById('media-video-template')!
        .cloneNode(true) as HTMLElement;

    wrapper.removeAttribute('id');

    const video = wrapper.querySelector('video') as HTMLVideoElement;

    video.poster = m.media_url_https || '';
    video.preload = 'none';
    video.muted = true;
    video.autoplay = false;
    video.playsInline = true;
    video.controls = true;

    const hlsSource = m.video_info?.variants.find(v => v.content_type === "application/x-mpegURL")?.url;
    const mp4 = pickBestMp4(m);

    requestIdleCallback(() => {
        let hls: Hls | undefined;
        if (hlsSource && Hls.isSupported()) {
            hls = new Hls();
            hls.loadSource(hlsSource);
            hls.attachMedia(video);
        } else if (hlsSource && video.canPlayType("application/vnd.apple.mpegurl")) {
            video.src = hlsSource;
        } else if (mp4) {
            const src = document.createElement("source");
            src.src = mp4.url;
            src.type = mp4.content_type;
            video.appendChild(src);
        }

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                const targetVideo = entry.target as HTMLVideoElement;
                if (entry.isIntersecting) {
                    targetVideo.play().catch(() => {});
                } else {
                    targetVideo.pause();
                }
            });
        }, { threshold: 0.5 });

        observer.observe(video);

        videoControllers.set(video, { observer, hls });
    });

    const badge = wrapper.querySelector('.duration-badge') as HTMLElement | null;
    if (badge && m.video_info?.duration_millis != null) {
        const totalSeconds = Math.floor(m.video_info.duration_millis / 1000);
        badge.textContent = msToClock(m.video_info.duration_millis);

        video.addEventListener('timeupdate', () => {
            const remaining = Math.max(0, totalSeconds - Math.floor(video.currentTime));
            const min = Math.floor(remaining / 60);
            const sec = remaining % 60;
            badge.textContent = `${min}:${sec.toString().padStart(2, '0')}`;
        });
    } else if (badge) {
        badge.remove();
    }

    return wrapper;
}

export function cleanupVideo(video: HTMLVideoElement) {
    const controller = videoControllers.get(video);
    if (!controller) return;
    controller.observer.disconnect();
    controller.hls?.destroy?.();
    videoControllers.delete(video);
}

function pickBestMp4(m: TweetMediaEntity) {
    return m.video_info?.variants
        ?.filter(v => v.content_type === 'video/mp4')
        .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];
}

function msToClock(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const pad = (n: number) => n.toString().padStart(2, '0');

    return hours > 0
        ? `${hours}:${pad(minutes)}:${pad(seconds)}`   // 1:05:07
        : `${minutes}:${pad(seconds)}`;               // 4:09
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
