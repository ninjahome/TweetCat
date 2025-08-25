import {TweetMediaEntity, TweetObj} from './tweet_entry';
import {bindTwitterInternalLink, cloneFromTpl, ensurePhotoLightbox} from './render_common';
import {updateTweetContentArea} from './render_content';
import {formatTweetTime, formatVideoDuration} from "../common/utils";
import {logRQ} from "../common/debug_flags";
import {videoRender} from "./render_video";

function pickQuotedBasics(quoted: TweetObj) {
    const name = quoted?.author?.displayName ?? '';
    const handle = quoted?.author?.screenName ?? '';
    const avatar = quoted?.author?.avatarImgUrl ?? '';
    const tc: any = quoted?.tweetContent ?? {};
    const createdAtRaw =
        tc.created_at ??
        tc.createdAt ??
        tc.createdAtStr ??
        tc.legacy?.created_at ??
        '';

    return {name, handle, avatar, createdAtRaw};
}

function toMiniAvatar(url: string): string {
    if (!url) return url;
    return url.replace('_normal', '_mini').replace('_bigger', '_mini').replace('400x400', 'mini');
}

// —— 阶段 1：Header —— //
function fillQuotedHeader(root: HTMLElement, quoted: TweetObj, tpl: HTMLTemplateElement): void {
    const headerEl = cloneFromTpl(tpl, 'tcqTplQuotedHeader');
    if (!headerEl) {
        console.warn('[QuotedTweet] template "tcqTplQuotedHeader" not found.');
        return;
    }

    const {name, handle, avatar, createdAtRaw} = pickQuotedBasics(quoted);
    const avatarMini = toMiniAvatar(avatar);

    const avatarImg = headerEl.querySelector<HTMLImageElement>('[data-role="avatar"] img');
    const nameEl = headerEl.querySelector<HTMLElement>('[data-role="name"]');
    const handleEl = headerEl.querySelector<HTMLElement>('[data-role="handle"]');
    const timeEl = headerEl.querySelector<HTMLTimeElement>('[data-role="time"]');

    if (avatarImg) {
        avatarImg.src = avatarMini || avatar || '';
        avatarImg.alt = name || handle || '';
    }
    if (nameEl) nameEl.textContent = name || handle || '';
    if (handleEl) handleEl.textContent = handle ? `@${handle}` : '';

    // 用你们的工具直接格式化展示文本；datetime 保持 ISO
    const timeText = formatTweetTime(createdAtRaw);
    const d = new Date(createdAtRaw);
    const datetime = isNaN(d.getTime()) ? '' : d.toISOString();
    if (timeEl) {
        timeEl.textContent = String(timeText ?? '');
        if (datetime) timeEl.setAttribute('datetime', datetime);
    }

    const headerSlot = root.querySelector<HTMLElement>('[data-tcq-slot="header"]');
    if (headerSlot) {
        headerSlot.innerHTML = '';
        headerSlot.appendChild(headerEl);
    }
}

// —— 阶段 2：正文 —— //
function fillQuotedContent(
    root: HTMLElement,
    quoted: TweetObj,
    tpl: HTMLTemplateElement,
    condensed: boolean // B2: true（主推有媒体）; B1: false（主推无媒体）
): void {
    // 1) 克隆并挂载容器
    const wrap = cloneFromTpl(tpl, 'tcqTplQuotedContent') as HTMLElement;
    const slot = root.querySelector<HTMLElement>('[data-tcq-slot="content"]')!;
    slot.innerHTML = '';
    slot.appendChild(wrap);

    // 2) 渲染正文到 wrap（项目惯例）
    updateTweetContentArea(wrap as unknown as HTMLElement, quoted.tweetContent, {isQuoted: true});

    // 3) 拿到正文和“显示更多”
    const textEl = wrap.querySelector<HTMLElement>('.tweet-content')!;
    const moreEl = wrap.querySelector<HTMLAnchorElement>('.tcq-qcontent-more')!;

    const shouldShowMore = !condensed && !!quoted.hasNoteExpandable;
    // 调试
    logRQ('[Quoted][fill] decision', {
        condensed,
        hasNoteExpandable: quoted.hasNoteExpandable,
        shouldShowMore
    });

    textEl.classList.add('tcq-qcontent--clamp-regular'); // 始终折叠 5 行

    // 4) A1+B2：主推有媒体 → 不显示“更多”
    if (!shouldShowMore) {
        moreEl.hidden = true;                 // 保险：display 由 hidden 控制
        moreEl.setAttribute('hidden', '');    // 模板可能自带 hidden，重复设定无害
        return;
    }

    // 5) A1+B1：主推无媒体 → 一定显示“更多”
    moreEl.hidden = false;
    moreEl.removeAttribute('hidden');                    // 确保可见

    // 详情页链接（优先根锚点）
    const sn = quoted?.author?.screenName ?? '';
    const id = quoted?.tweetContent?.id_str ?? (quoted as any)?.rest_id ?? '';
    const href = (sn && id) ? `/${sn}/status/${id}` : '';
    bindTwitterInternalLink(moreEl, href);
    // 调试日志（可保留，便于核对）
    logRQ('[Quoted][A1+B1] force-show more', {href, condensed})
}


// —— 根容器交互：整卡可点（媒体/正文链接例外） —— //
function wireQuotedRootInteractions(root: HTMLElement, quoted: TweetObj): void {
    const screenName = quoted?.author?.screenName ?? '';
    const statusId = quoted?.tweetContent?.id_str ?? '';
    if (!screenName || !statusId) return;

    const statusHref = `/${screenName}/status/${statusId}`;
    const rootLink = root.querySelector<HTMLAnchorElement>('#tcqTplQuotedRootLink');
    if (rootLink) {
        rootLink.href = statusHref;
        try {
            bindTwitterInternalLink(rootLink, statusHref);
        } catch {
        }
    }

    function shouldOpenStatus(target: Element) {
        if (target.closest('.tcq-qmedia')) return false;            // ✅ 媒体容器自身/祖先命中
        if (target.closest('.tcq-quoted-content a')) return false;  // 正文链接
        if (target.closest('.tcq-quoted-card a')) return false;     // 卡片链接
        return true;
    }

    const onRootClick = (ev: MouseEvent) => {
        const t = ev.target as Element | null;
        if (!t || !rootLink) return;
        if (!shouldOpenStatus(t)) return; // 放行例外
        ev.preventDefault();
        ev.stopPropagation();
        rootLink.click();                 // 触发已绑定 SPA 的隐形锚点
    };

    const onRootKey = (ev: KeyboardEvent) => {
        if (!rootLink) return;
        if (ev.key !== 'Enter' && ev.key !== ' ') return;

        const t = (document.activeElement as Element) || (ev.target as Element);
        // 与 click 一致的豁免判断
        if (!shouldOpenStatus(t)) return;

        ev.preventDefault();
        ev.stopPropagation();
        rootLink.click();
    };


    if (!(root as any)._tcq_wired) {
        root.addEventListener('click', onRootClick);
        root.addEventListener('keydown', onRootKey);
        (root as any)._tcq_wired = true;
    }
}


function renderQuotedPhotos(root: HTMLElement, tpl: HTMLTemplateElement, mediaSlot: HTMLElement, photos: TweetMediaEntity[], condensed: boolean) {
    if (!photos.length) return;

    const count = Math.min(4, photos.length);
    // 媒体容器挂张数类
    mediaSlot.classList.add(`tcq-qphoto--grid-${count}`);

    const isB2Single = condensed && count === 1;
    mediaSlot.classList.toggle('tcq-qphoto--thumb', isB2Single);
    root.classList.toggle('tcq--thumb-row', condensed);        // 所有 B2 都用行内布局（Header 顶部）

    // —— 渲染图片（不做 TS 动态纵横比；交互仅 Lightbox） —— //
    photos.slice(0, count).forEach((m: any, i: number) => {
        const anchor = cloneFromTpl(tpl, 'tcqTplQuotedPhoto') as HTMLAnchorElement | null;
        if (!anchor) return;
        anchor.removeAttribute('id');

        const img = anchor.querySelector('img') as HTMLImageElement | null;
        const src = m.media_url_https || '';
        if (!src) return; // 优雅跳过
        if (img) {
            img.src = src;
            img.alt = m.display_url || '';
            img.decoding = 'async';
            img.loading = 'lazy';
        }

        // 仅打开轻量 Lightbox（不跳转详情）
        anchor.href = '#';
        anchor.dataset.photoIndex = String(i);
        anchor.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const {root: lbRoot, img: lbImg} = ensurePhotoLightbox(tpl);
            lbImg.src = src;
            lbImg.alt = img?.alt || '';
            lbRoot.hidden = false;
        });

        mediaSlot.appendChild(anchor);
    });
}

function renderQuotedVideos(root: HTMLElement, tpl: HTMLTemplateElement, mediaSlot: HTMLElement, videos: TweetMediaEntity[], condensed: boolean) {
// —— 无图片且有视频/GIF —— //
    if (!videos.length) return;
    const first = videos[0];

    // B2：紧凑卡仅显示海报 + 角标；点击跳详情
    if (condensed) {
        const node = cloneFromTpl(tpl, 'tcqTplQuotedVideo') as HTMLElement | null;
        if (!node) return;
        node.removeAttribute('id');

// 2) 取到各占位
        const anchor = node.querySelector<HTMLAnchorElement>('a.tcq-qvideo') as HTMLAnchorElement;
        const img = node.querySelector<HTMLImageElement>('.tcq-qvideo-poster') as HTMLImageElement;
        const aspect = node.querySelector<HTMLElement>('.tcq-qmedia-aspect') as HTMLElement;
        const badge = node.querySelector<HTMLElement>('.duration-badge') as HTMLElement;

        const poster = first.media_url_https || '';
        if (!poster) {
            // 没有可用海报就不渲染媒体，保持区域为空（优雅降级）
            return;
        }
        if (img) {
            img.src = poster;
            img.alt = first.display_url || '';
            img.loading = 'lazy';
            img.decoding = 'async';
        }

        // ① 优先用 video_info.aspect_ratio
        const ratio = first?.video_info?.aspect_ratio;
        if (aspect && Array.isArray(ratio) && ratio.length === 2) {
            aspect.style.aspectRatio = `${ratio[0]} / ${ratio[1]}`;
            aspect.style.paddingTop = '';
        }

        // ② 回退：用 original_info 的 width/height
        if (
            aspect &&
            (!Array.isArray(ratio) || ratio.length !== 2) &&
            first.original_info?.width &&
            first.original_info?.height
        ) {
            aspect.style.aspectRatio = `${first.original_info.width} / ${first.original_info.height}`;
            aspect.style.paddingTop = '';
        }

        // 角标：视频=时长，GIF=“GIF”
        badge.classList.toggle('is-gif', first.type === 'animated_gif');
        if (first.type === 'animated_gif') {
            badge.textContent = 'GIF';
            badge.hidden = false;
        } else {
            const ms = first?.video_info?.duration_millis;
            if (typeof ms === 'number') {
                badge.textContent = formatVideoDuration(Math.floor(ms / 1000));
                badge.hidden = false;
            } else {
                badge.hidden = true;
            }
        }

        // 布局类（与 B2 图片缩略一致）
        mediaSlot.classList.add('tcq-qphoto--grid-1', 'tcq-qphoto--thumb');
        root.classList.add('tcq--thumb-row');

        // 点击跳被引详情（不在卡内播放）
        anchor.href = '#';
        anchor.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            root.querySelector<HTMLAnchorElement>('#tcqTplQuotedRootLink')?.click();
        });

        mediaSlot.appendChild(node);
        return;
    }

    // B1：普通卡内嵌播放器
    const player = videoRender(first, tpl);
    const isGif = first.type === 'animated_gif';
    player.classList.add('tcq-qvideo-host', 'tcq-qmedia');

    if (!isGif) {
        // 阻断点击/触摸事件冒泡，避免触发整卡跳转
        ['click', 'pointerdown', 'touchstart'].forEach(evt => {
            player.addEventListener(evt, e => {
                e.stopPropagation();
            }, {passive: true});
        });
        const vEl = player.querySelector('video') as HTMLVideoElement | null;
        if (vEl) {
            ['click', 'pointerdown', 'touchstart'].forEach(evt => {
                vEl.addEventListener(evt, e => e.stopPropagation(), {passive: true});
            });
        }
    } else {
        const v = player.querySelector('video') as HTMLVideoElement | null;
        const badge = player.querySelector('.duration-badge') as HTMLElement | null;
        if (badge) badge.style.display = 'none';
        if (v) {
            v.loop = true;
            v.muted = true;
            v.autoplay = true;
            v.controls = false;
            v.playsInline = true;
        }
    }

    mediaSlot.appendChild(player);
}

function fillQuotedMedia(
    root: HTMLElement,
    quoted: TweetObj,
    tpl: HTMLTemplateElement,
    condensed: boolean
): void {
    const mediaSlot = root.querySelector<HTMLElement>('[data-tcq-slot="media"]');
    if (!mediaSlot) return;

    // 清空旧内容 & 清理旧类
    mediaSlot.innerHTML = '';
    ['tcq-qphoto--grid-1', 'tcq-qphoto--grid-2', 'tcq-qphoto--grid-3', 'tcq-qphoto--grid-4', 'tcq-qphoto--thumb']
        .forEach(c => mediaSlot.classList.remove(c));
    root.classList.remove('tcq--thumb-row');

    // 取媒体（优先 extended_entities）
    const all: TweetMediaEntity[] =
        quoted?.tweetContent?.extended_entities?.media?.length
            ? quoted.tweetContent.extended_entities.media
            : (quoted?.tweetContent?.entities?.media || []) as TweetMediaEntity[];


    if (!all?.length) {
        mediaSlot.style.display = 'none';
        return;
    }

    const photos = all.filter((m: any) => m?.type === 'photo');
    if (photos.length > 0) {
        renderQuotedPhotos(root, tpl, mediaSlot, photos, condensed);
        return;
    }

    const videos = all.filter(m => m?.type === 'video' || m?.type === 'animated_gif');
    if (videos.length > 0) {
        renderQuotedVideos(root, tpl, mediaSlot, videos, condensed);
    }
}

export function updateTweetQuoteArea(
    container: HTMLElement,
    quoted: TweetObj | null | undefined,
    tpl: HTMLTemplateElement,
    condensed: boolean
): void {
    logRQ("------>>> quoted data to render:", JSON.stringify(quoted));
    container.innerHTML = '';

    if (!quoted) {
        container.style.display = 'none';
        return;
    }

    const root = cloneFromTpl(tpl, 'tcqTplQuotedTweet');
    if (!root) {
        console.warn('[QuotedTweet] template "tcqTplQuotedTweet" not found.');
        container.style.display = 'none';
        return;
    }

    // 克隆 #tcqTplQuotedTweet 得到 root 后：
    root.classList.add('tcq-v2', condensed ? 'tcq--b2' : 'tcq--b1');

    const quotedBlock = root.querySelector(".tcq-quoted-block") as HTMLElement
    quotedBlock.classList.add(condensed ? 'tcq-quoted-block-row' : 'tcq-quoted-block-gap');

    fillQuotedHeader(root, quoted, tpl);   // 阶段 1
    fillQuotedContent(root, quoted, tpl, condensed);
    fillQuotedMedia(root, quoted, tpl, condensed);

    wireQuotedRootInteractions(root, quoted); // 整卡可点（关键差异）

    container.appendChild(root);
    container.style.display = 'block';
}
