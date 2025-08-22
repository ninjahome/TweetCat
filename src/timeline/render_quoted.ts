// render_quoted.ts
import {TweetObj} from './tweet_entry';
import {bindTwitterInternalLink} from './render_common';
import {updateTweetContentArea} from './render_content';
import {formatTweetTime} from "../common/utils";

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
    condensed: boolean
): void {
    // 1) 克隆正文子模板并先挂到 slot，确保样式就绪
    const wrap = cloneFromTpl(tpl, 'tcqTplQuotedContent')!;
    const slot = root.querySelector<HTMLElement>('[data-tcq-slot="content"]')!;
    slot.innerHTML = '';
    slot.appendChild(wrap);

    // 2) 用“wrap 作为容器”渲染正文（符合你项目惯例）
    updateTweetContentArea(wrap as unknown as HTMLElement, quoted.tweetContent);

    // 3) 取实际渲染节点
    const textEl = wrap.querySelector('.tweet-content') as HTMLElement;
    const moreEl = wrap.querySelector<HTMLAnchorElement>('.tcq-qcontent-more')!;

    // 4) B2（主推有媒体，condensed=true）：官方不显示“更多”
    if (condensed) {
        moreEl.hidden = true;
        return;
    }

    // 5) B1（主推无媒体）：先测“未折叠高度”，再折叠，再对比
    //    注意：如果先加 line-clamp 再测量，scrollHeight 会被 clamp，无法判断溢出
    const naturalHeight = textEl.scrollHeight;

    // 折叠 5 行
    textEl.classList.add('tcq-qcontent--clamp-regular');

    // 统一生成详情页链接（优先用 root 隐形锚点）
    const statusHref = (() => {
        const rootLink = root.querySelector<HTMLAnchorElement>('#tcqTplQuotedRootLink');
        if (rootLink?.href) return rootLink.href;
        const sn = quoted?.author?.screenName ?? '';
        const id = quoted?.tweetContent?.id_str ?? (quoted as any)?.rest_id ?? '';
        return (sn && id) ? `/${sn}/status/${id}` : '#';
    })();

    // 6) 下一帧再量折叠高度并对比，决定是否展示“显示更多”
    requestAnimationFrame(() => {
        const clampedHeight = textEl.clientHeight;
        const needMore = naturalHeight > clampedHeight + 1; // 容差 1px，避免字体/子像素抖动
        if (needMore) {
            moreEl.hidden = false;
            moreEl.href = statusHref;
            try {
                bindTwitterInternalLink(moreEl, statusHref);
            } catch {
            }
            // 防止点击“更多”触发整卡点击（root 上有整卡可点）
        } else {
            moreEl.hidden = true;
        }
    });
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

// render_quoted.ts —— 阶段 3 框架（空实现）
function fillQuotedMedia(
    root: HTMLElement,
    quoted: TweetObj,
    tpl: HTMLTemplateElement,
    condensed: boolean
): void {
    // 取媒体数组（没有就直接清空 slot 并返回）
    const medias = quoted?.tweetContent?.extended_entities?.media ?? [];
    const mediaSlot = root.querySelector<HTMLElement>('[data-tcq-slot="media"]');
    if (!mediaSlot) return;

    // 先清空
    mediaSlot.innerHTML = '';

    // 暂不渲染任何媒体（空实现）
    // 后续我们会在这里根据 medias[].type 与 condensed 分别渲染：
    // - photo: regular vs condensed
    // - animated_gif / video: 封面卡（阶段4）
    // - 无媒体：保持空
}

export function updateTweetQuoteArea(
    container: HTMLElement,
    quoted: TweetObj | null | undefined,
    tpl: HTMLTemplateElement,
    opts?: { condensed?: boolean }
): void {
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
