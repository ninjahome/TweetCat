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
    const all =
        quoted?.tweetContent?.extended_entities?.media?.length
            ? quoted.tweetContent.extended_entities.media
            : (quoted?.tweetContent?.entities?.media || []);

    const photos = all.filter((m: any) => m?.type === 'photo');
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
        const src = m.media_url_https || m.url || '';
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


    fillQuotedHeader(root, quoted, tpl);   // 阶段 1
    fillQuotedContent(root, quoted, tpl, condensed);
    fillQuotedMedia(root, quoted, tpl, condensed);  // ← 调用空实现

    wireQuotedRootInteractions(root, quoted); // 整卡可点（关键差异）

    container.appendChild(root);
    container.style.display = 'block';
}
