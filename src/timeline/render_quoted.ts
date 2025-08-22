import {TweetObj} from './tweet_entry';
import {bindTwitterInternalLink} from './render_common';
import {updateTweetContentArea} from './render_content';
import {formatTweetTime} from "../common/utils";
import {logRQ} from "../common/debug_flags";

// —— 通用 —— //
function cloneFromTpl(tpl: HTMLTemplateElement, id: string): HTMLElement | null {
    const node = tpl.content.getElementById(id);
    return node ? (node.cloneNode(true) as HTMLElement) : null;
}

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
    updateTweetContentArea(wrap as unknown as HTMLElement, quoted.tweetContent);

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

    // 4) A1+B2：主推有媒体 → 不显示“更多”
    if (!shouldShowMore) {
        moreEl.hidden = true;                 // 保险：display 由 hidden 控制
        moreEl.setAttribute('hidden', '');    // 模板可能自带 hidden，重复设定无害
        return;
    }

    // 5) A1+B1：主推无媒体 → 一定显示“更多”
    textEl.classList.add('tcq-qcontent--clamp-regular'); // 始终折叠 5 行
    moreEl.hidden = false;
    moreEl.removeAttribute('hidden');                    // 确保可见

    // 详情页链接（优先根锚点）
    const sn = quoted?.author?.screenName ?? '';
    const id = quoted?.tweetContent?.id_str ?? (quoted as any)?.rest_id ?? '';
    const href = (sn && id) ? `/${sn}/status/${id}` : '';
    bindTwitterInternalLink(moreEl, href);
    // 调试日志（可保留，便于核对）
    logRQ('[Quoted][A1+B1] force-show more', {href, condensed});
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

    const shouldOpenStatus = (target: Element) => {
        if (target.closest('.tcq-qmedia a')) return false;               // 媒体子链接（阶段3）
        if (target.closest('.tcq-quoted-content a')) return false;       // 正文里的任何链接
        if (target.closest('.tcq-quoted-card a')) return false;          // 卡片里的链接（阶段5）
        return true;
    };

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
        if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            ev.stopPropagation();
            rootLink.click();
        }
    };

    if (!(root as any)._tcq_wired) {
        root.addEventListener('click', onRootClick);
        root.addEventListener('keydown', onRootKey);
        (root as any)._tcq_wired = true;
    }
}


// 仅保留一个实例：从模板克隆并挂到 <body>，而不是 createElement
function ensurePhotoLightbox(tpl: HTMLTemplateElement) {
    const INSTANCE_ID = 'tcqPhotoLightbox'; // 运行时实例 id
    let root = document.getElementById(INSTANCE_ID) as HTMLElement | null;

    if (!root) {
        const cloned = cloneFromTpl(tpl, 'tcqTplPhotoLightbox') as HTMLElement | null;
        if (!cloned) throw new Error('tpl tcqTplPhotoLightbox not found');
        // 兼容 cloneFromTpl 可能返回外层 .tcq-tpl：取里面的真正根
        root = cloned.matches('.tcq-photo-lightbox')
            ? cloned
            : (cloned.querySelector('.tcq-photo-lightbox') as HTMLElement);
        if (!root) throw new Error('lightbox root missing');
        root.id = INSTANCE_ID;
        document.body.appendChild(root);
    }

    const img = root.querySelector('.tcq-plb-img') as HTMLImageElement;
    const close = root.querySelector('.tcq-plb-close') as HTMLButtonElement;

    if (!root.dataset.wired) {
        root.addEventListener('click', (e) => {
            if (e.target === root) root.hidden = true;
        });
        close?.addEventListener('click', () => (root.hidden = true));
        document.addEventListener('keydown', (e) => {
            if (!root.hidden && (e.key === 'Escape' || e.key === 'Esc')) root.hidden = true;
        });
        root.dataset.wired = '1';
    }
    return {root, img, close};
}

// 单图 + B1 时，按原图尺寸动态设定纵横比（夹在 16:9 ~ 3:4）
function applyDynamicAspect(
    aspectEl: HTMLElement,
    media: any
) {
    // 取原始尺寸（优先 original_info，退到 sizes）
    const w =
        media?.original_info?.width ??
        media?.sizes?.large?.w ??
        media?.sizes?.medium?.w ??
        media?.sizes?.small?.w ?? 0;

    const h =
        media?.original_info?.height ??
        media?.sizes?.large?.h ??
        media?.sizes?.medium?.h ??
        media?.sizes?.small?.h ?? 0;

    if (w > 0 && h > 0) {
        // 百分比 padding-top；在 56.25%(16:9) ~ 133.34%(≈3:4) 之间夹取
        const pct = Math.max(56.25, Math.min(133.34, (h / w) * 100));
        aspectEl.style.paddingTop = pct + '%';
    }
}


// —— 阶段 3：Photo 渲染 —— //
function fillQuotedMedia(
    root: HTMLElement,
    quoted: TweetObj,
    tpl: HTMLTemplateElement,
    condensed: boolean
): void {
    const mediaSlot = root.querySelector<HTMLElement>('[data-tcq-slot="media"]');
    if (!mediaSlot) return;
    mediaSlot.innerHTML = '';

    // media 列表（优先 extended_entities）
    const all =
        quoted?.tweetContent?.extended_entities?.media?.length
            ? quoted.tweetContent.extended_entities.media
            : (quoted?.tweetContent?.entities?.media || []);

    const photos = all.filter(m => m?.type === 'photo');
    if (!photos.length) {
        // 阶段4再处理 GIF/Video；此处仅渲染 photo
        return;
    }

    // B1/B2：高度差异由容器 class 控制（CSS 中调整 aspect）
    const count = Math.min(4, photos.length);
    mediaSlot.classList.add(`tcq-qphoto--grid-${count}`);
    mediaSlot.classList.toggle('tcq-qphoto--regular', !condensed);
    mediaSlot.classList.toggle('tcq-qphoto--condensed', condensed);

    // B2 + 单图：启用“横排缩略图”布局
    root.classList.toggle('tcq--thumb-row', condensed && count === 1);

    if (condensed && count === 1) {
        mediaSlot.classList.add('tcq-qphoto--thumb');
    } else {
        mediaSlot.classList.remove('tcq-qphoto--thumb');
    }


    photos.slice(0, 4).forEach((m, i) => {
        const anchor = cloneFromTpl(tpl, 'tcqTplQuotedPhoto') as HTMLAnchorElement | null;
        if (!anchor) return;
        anchor.removeAttribute('id');

        // 填图
        const img = anchor.querySelector('img') as HTMLImageElement | null;
        const src = m.media_url_https || m.url || '';
        if (img) {
            img.src = m.media_url_https || m.url || '';
            img.alt = m.display_url || '';
            img.decoding = 'async';
            img.loading = 'lazy';
        }

        // ★ 仅在 B1（!condensed）且单图时，放开纵横比为更“竖”的高度
        const aspect = anchor.querySelector('.tcq-qmedia-aspect') as HTMLElement | null;
        if (aspect && !condensed && count === 1) {
            applyDynamicAspect(aspect, m);
        }

        anchor.href = '#';
        anchor.addEventListener('click', (e) => {
            e.preventDefault();           // 不走详情
            e.stopPropagation();
            const {root: lbRoot, img: lbImg} = ensurePhotoLightbox(tpl);
            lbImg.src = src;
            lbImg.alt = img?.alt || '';
            lbRoot.hidden = false;        // 显示覆盖层
        });

        // index 标记（可供 viewer 使用）
        anchor.dataset.photoIndex = String(i);

        mediaSlot.appendChild(anchor);
    });
}

export function updateTweetQuoteArea(
    container: HTMLElement,
    quoted: TweetObj | null | undefined,
    tpl: HTMLTemplateElement,
    opts?: { condensed?: boolean }
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

    fillQuotedHeader(root, quoted, tpl);   // 阶段 1
    fillQuotedContent(root, quoted, tpl, !!opts?.condensed);
    fillQuotedMedia(root, quoted, tpl, !!opts?.condensed);  // ← 调用空实现

    wireQuotedRootInteractions(root, quoted); // 整卡可点（关键差异）

    container.appendChild(root);
    container.style.display = 'block';
}
