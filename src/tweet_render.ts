import {EntryObj, TweetAuthor, TweetContent, TweetMediaEntity} from "./object_tweet";
import {formatCount, formatTweetTime} from "./utils";

export function renderTweetsBatch(entries: EntryObj[], contentTemplate: HTMLTemplateElement): DocumentFragment {
    const fragment = document.createDocumentFragment();

    entries.forEach((entry, index) => {
        const tweetNode = renderTweetHTML(index, entry, contentTemplate);
        fragment.appendChild(tweetNode);
    });

    return fragment;
}

export function renderTweetHTML(index: number, tweetEntry: EntryObj, tpl: HTMLTemplateElement, estimatedHeight: number = 450): HTMLElement {
    const tweetCellDiv = tpl.content.getElementById("tweeCatCellDiv")!.cloneNode(true) as HTMLDivElement;
    tweetCellDiv.style.transform = `translateY(${index * estimatedHeight}px)`;
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

    //
    // // 3. 若是转推 ➜ 在顶部插入 “@outer.author.displayName reposted”
    // if (outer.retweetedStatus) {
    //     insertRepostedBanner(article, outer.author, tpl);   // 你自己的函数
    // }
    //
    // 4. 正文文本 = target.tweetContent.full_text  (注意 entity 等都用 target)
    updateTweetContentArea(article.querySelector(".tweet-body") as HTMLElement, target.tweetContent);
    //
    // updateTweetMediaArea(article, target.tweetContent, tpl);

    updateTweetBottomButtons(article.querySelector(".tweet-actions") as HTMLElement,
        target.tweetContent, target.author.legacy.screenName, target.views_count);

    return tweetCellDiv;
}


function getHighResAvatarUrl(url: string): string {
    return url.replace('_normal', '_400x400');
}

// 渲染头像模块
export function updateTweetAvatar(avatarArea: Element, author: TweetAuthor): void {
    // const highResUrl = getHighResAvatarUrl(author.legacy.profile_image_url_https);
    const highResUrl = author.legacy.profile_image_url_https;

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
    article: Element,
    author: TweetAuthor,
    tpl: HTMLTemplateElement,
): void {
    // ① 找占位 <div class="tweetCatTopTipsArea …">
    const host = article.querySelector('.tweetCatTopTipsArea') as HTMLElement | null;
    if (!host) return;

    // ② 克隆模板内部结构
    const raw = tpl.content.getElementById('tweetCatTopTipsArea') as HTMLElement | null;
    if (!raw) return;
    const banner = raw.cloneNode(true) as HTMLElement;
    banner.removeAttribute('id');

    // ③ 注入动态数据
    const a = banner.querySelector('a.retweetUserName') as HTMLAnchorElement | null;
    if (a) a.href = `/${author.legacy.screenName}`;
    const disp = banner.querySelector('.retweetDisplayName');
    if (disp) disp.textContent = author.legacy.displayName;

    // ⑤ 清掉旧内容并塞入 banner
    host.innerHTML = '';
    host.appendChild(banner);
}

export function updateTweetMediaArea(
    container: Element,
    tweetContent: TweetContent,
    tpl: HTMLTemplateElement,
): void {
    /** 获取放置媒体的占位容器 */
    const mediaArea = container.querySelector('.media-show-area') as HTMLElement | null;
    if (!mediaArea) return;

    // 清空旧内容
    mediaArea.innerHTML = '';
    /** Tweet.media 列表（优先 extended_entities.media，没有就回退到 entities.media） */
    const mediaList: TweetMediaEntity[] =
        tweetContent.extended_entities?.media?.length
            ? tweetContent.extended_entities.media
            : tweetContent.entities?.media || [];

    if (!mediaList.length) return; // 无媒体

    mediaArea.classList.add(`count-${mediaList.length}`)

    const photos = mediaList.filter(m => m.type === 'photo');
    const videos = mediaList.filter(m => m.type === 'video' || m.type === 'animated_gif');

    if (photos.length > 0) {
        mediaArea.append(photoRender(photos, tpl));
    }

    for (const media of videos) {
        mediaArea.append(videoRender(media, tpl));
    }
}


function videoRender(m: TweetMediaEntity, tpl: HTMLTemplateElement): HTMLElement {
    const wrapper = tpl.content
        .getElementById('tweet-media-wrapper-video-template')!
        .cloneNode(true) as HTMLElement;

    wrapper.removeAttribute('id');

    const video = wrapper.querySelector('video') as HTMLVideoElement;

    /* --------- 1️⃣ 先把模板里自带的所有 <source> 清掉 ---------- */
    while (video.firstChild) video.removeChild(video.firstChild);

    /* --------- 2️⃣ 填充我们自己的资源 ---------- */
    video.poster = m.media_url_https || '';

    const mp4 = pickBestMp4(m);        // 选 bitrate 最大的 mp4
    if (mp4) {
        const src = document.createElement('source');
        src.src = mp4.url;
        src.type = mp4.content_type;      // "video/mp4"
        video.appendChild(src);
    }

    /* 3️⃣ 统一自动播放体验 */
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;

    /* 4️⃣ duration badge */
    const badge = wrapper.querySelector('.duration-badge') as HTMLElement | null;
    if (badge && m.video_info?.duration_millis != null) {
        badge.textContent = msToClock(m.video_info.duration_millis);
    } else if (badge) {
        badge.remove();
    }

    /* 5️⃣ IntersectionObserver 控制播放（可选，节流） */
    // addAutoplayObserver(video);

    return wrapper;
}

function pickBestMp4(m: TweetMediaEntity) {
    return m.video_info?.variants
        ?.filter(v => v.content_type === 'video/mp4')
        .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];
}


export function msToClock(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const pad = (n: number) => n.toString().padStart(2, '0');

    return hours > 0
        ? `${hours}:${pad(minutes)}:${pad(seconds)}`   // 1:05:07
        : `${minutes}:${pad(seconds)}`;               // 4:09
}

export function addAutoplayObserver(root: HTMLElement): () => void {
    /** 记录目前在可见区内的所有 <video> */
    const visible = new Set<HTMLVideoElement>();

    /** 记录当前真正播放的那个 */
    let current: HTMLVideoElement | null = null;

    /** 辅助：计算某元素到视口中心点的距离平方（不做 sqrt 更快） */
    const dist2ToViewportCenter = (el: HTMLElement): number => {
        const rect = el.getBoundingClientRect();
        // 元素中心
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        // 视口中心
        const vx = window.innerWidth / 2;
        const vy = window.innerHeight / 2;
        const dx = cx - vx;
        const dy = cy - vy;
        return dx * dx + dy * dy;
    };

    let best: HTMLVideoElement | null = null;
    /** 切换播放对象 */
    const updatePlayback = () => {
        if (visible.size === 0) {
            if (current) {
                current.pause();
                current = null;
            }
            return;
        }
        // 找离中心最近的视频
        let bestScore = Number.POSITIVE_INFINITY;
        visible.forEach((v) => {
            const score = dist2ToViewportCenter(v);
            if (score < bestScore) {
                bestScore = score;
                best = v;
            }
        });
        if (best && best !== current) {
            // 切换
            if (current) current.pause();
            best.muted = true;              // 静音自动播放（避免被浏览器拦截）
            const playPromise = best.play();
            if (playPromise) {
                playPromise.catch(() => {
                    /* 浏览器策略阻止时忽略 */
                });
            }
            current = best;
        }
        // 把其余暂停
        visible.forEach((v) => {
            if (v !== current) v.pause();
        });
    };

    /** 滚动 & 尺寸变化时重新评估 */
    const scheduleUpdate = (() => {
        let ticking = false;
        return () => {
            if (!ticking) {
                ticking = true;
                requestAnimationFrame(() => {
                    ticking = false;
                    updatePlayback();
                });
            }
        };
    })();

    /** 监听可见性 */
    const io = new IntersectionObserver(
        (entries) => {
            entries.forEach((e) => {
                const vid = e.target as HTMLVideoElement;
                if (e.isIntersecting) {
                    visible.add(vid);
                } else {
                    visible.delete(vid);
                    vid.pause();
                    if (current === vid) current = null;
                }
            });
            scheduleUpdate();
        },
        {
            root: null,
            threshold: 0.25, // 元素至少 25% 进入视口才算“可见”
        }
    );

    /** 对 root 内已有和后续新增的视频都 attach */
    const attachToVideo = (v: HTMLVideoElement) => {
        // 确保不会重复 observe
        io.observe(v);
    };
    root.querySelectorAll('video').forEach((v) => attachToVideo(v as HTMLVideoElement));

    /** MutationObserver — 处理后续渲染出来的新 <video> */
    const mo = new MutationObserver((mutations) => {
        mutations.forEach((m) => {
            m.addedNodes.forEach((n) => {
                if (n instanceof HTMLVideoElement) {
                    attachToVideo(n);
                } else if (n instanceof HTMLElement) {
                    n.querySelectorAll('video').forEach((v) => attachToVideo(v as HTMLVideoElement));
                }
            });
            // 移除的节点自动由 IntersectionObserver unobserve → pause
        });
    });
    mo.observe(root, {childList: true, subtree: true});

    // 滚动和 resize
    window.addEventListener('scroll', scheduleUpdate, {passive: true});
    window.addEventListener('resize', scheduleUpdate);

    /** 调用者可在销毁时执行，以清理监听 */
    return function clean() {
        io.disconnect();
        mo.disconnect();
        window.removeEventListener('scroll', scheduleUpdate);
        window.removeEventListener('resize', scheduleUpdate);
        visible.forEach((v) => v.pause());
        visible.clear();
        current = null;
    };
}


function scaleToFitBox(origW: number, origH: number, maxW: number, maxH: number) {
    const ratio = Math.min(maxW / origW, maxH / origH);
    return {
        width: origW * ratio,
        height: origH * ratio
    };
}


function renderSinglePhoto(media: TweetMediaEntity, tpl: HTMLTemplateElement): HTMLElement {

    const wrapper = tpl.content
        .getElementById('tweet-media-wrapper-photo-template')!
        .cloneNode(true) as HTMLElement;

    wrapper.removeAttribute('id');

    const container = wrapper.querySelector('.tweetPhotoContainer') as HTMLElement;

    const itemTpl = tpl.content.getElementById('tweet-media-wrapper-photo')!;
    const item = itemTpl.cloneNode(true) as HTMLElement;

    // 设置图片尺寸（根据推文中的原始宽高）
    if (media.original_info) {
        // 推特客户端实际使用的是 maxHeight = 510px
        const box = scaleToFitBox(media.original_info.width, media.original_info.height, 9999, 510);
        const outer = item.querySelector('.tweetPhotoSize') as HTMLElement;
        const ratioDiv = item.querySelector('.tweetPhotoRatio') as HTMLElement;
        if (outer) {
            outer.style.width = `${box.width}px`;
            outer.style.height = `${box.height}px`;
        }
        if (ratioDiv) {
            const ratioPercent = (media.original_info.height / media.original_info.width) * 100;
            ratioDiv.style.paddingBottom = `${ratioPercent.toFixed(2)}%`;
        }
    }

    replacePhotoItem(item, media);

    container.appendChild(item);

    return wrapper;
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

function renderMultiPhoto(media: TweetMediaEntity, tpl: HTMLTemplateElement): HTMLElement {
    const itemTpl = tpl.content.getElementById('tweet-media-wrapper-photo-multi')!;
    const item = itemTpl.cloneNode(true) as HTMLElement;
    replacePhotoItem(item, media);
    return item;
}

function renderMultiPhotoGroup(medias: TweetMediaEntity[], tpl: HTMLTemplateElement): HTMLElement {
    const count = medias.length;
    const wrapper = tpl.content.getElementById('tweet-media-wrapper-photo-base')!
        .cloneNode(true) as HTMLElement;
    wrapper.removeAttribute('id');

    const rootClass = `tweetPhotoGroupRootTemplate${count}`;
    const groupTpl = tpl.content.getElementById(rootClass)!;
    const group = groupTpl.cloneNode(true) as HTMLElement;

    const containers = group.querySelectorAll('.tweetPhotoContainer');
    for (let i = 0; i < medias.length; i++) {
        const item = renderMultiPhoto(medias[i], tpl);
        containers[i]?.appendChild(item);
    }

    const root = wrapper.querySelector('.tweetPhotoGroupRoot');
    if (root) root.appendChild(group);

    return wrapper;
}

export function photoRender(medias: TweetMediaEntity[], tpl: HTMLTemplateElement): HTMLElement {
    if (medias.length === 1) {
        return renderSinglePhoto(medias[0], tpl);
    }
    return renderMultiPhotoGroup(medias, tpl);
}

export function updateTweetBottomButtons(
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
