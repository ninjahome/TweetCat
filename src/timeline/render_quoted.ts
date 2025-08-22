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
    // 1) 克隆并挂载容器
    const wrap = cloneFromTpl(tpl, 'tcqTplQuotedContent') as HTMLElement;
    const slot = root.querySelector<HTMLElement>('[data-tcq-slot="content"]')!;
    slot.innerHTML = '';
    slot.appendChild(wrap);

    // 2) 按你们的惯例：把“wrap 当容器”渲染正文（这一步会生成 .tweet-content）
    updateTweetContentArea(wrap as unknown as HTMLElement, quoted.tweetContent);

    // 3) 渲染完再抓真实节点
    const textEl = wrap.querySelector<HTMLElement>('.tweet-content')!;
    const moreEl = wrap.querySelector<HTMLAnchorElement>('.tcq-qcontent-more')!;

    // 调试：看一下关键节点是否拿到了
    console.log('[Quoted][fill] nodes', {
        hasText: !!textEl, hasMore: !!moreEl, condensed
    });

    // B2（主推有媒体）：官方不显示“更多”
    if (condensed) {
        moreEl.hidden = true;
        return;
    }

    // B1：开启折叠样式
    textEl.classList.add('tcq-qcontent--clamp-regular');

    // 详情跳转（优先根隐形锚点）
    const statusHref = (() => {
        const rk = root.querySelector<HTMLAnchorElement>('#tcqTplQuotedRootLink');
        if (rk?.href) return rk.href;
        const sn = quoted?.author?.screenName ?? '';
        const id = quoted?.tweetContent?.id_str ?? (quoted as any)?.rest_id ?? '';
        return (sn && id) ? `/${sn}/status/${id}` : '#';
    })();

    // 4) 用“移除折叠→测自然高→恢复折叠”的办法判断是否需要“显示更多”
    requestAnimationFrame(() => {
        const hClamped = textEl.getBoundingClientRect().height;

        // 可能有异步富文本替换；双 rAF 更稳
        textEl.classList.remove('tcq-qcontent--clamp-regular');
        requestAnimationFrame(() => {
            const hNatural = textEl.getBoundingClientRect().height;
            textEl.classList.add('tcq-qcontent--clamp-regular');

            const willShow = hNatural > hClamped + 0.5;
            console.log('[Quoted][A1+B1] measure', {hClamped, hNatural, willShow});

            if (willShow) {
                moreEl.hidden = false;
                moreEl.href = statusHref;
                try {
                    bindTwitterInternalLink(moreEl, statusHref);
                } catch {
                }
                // 避免“更多”点击触发整卡 click
                moreEl.addEventListener('click', ev => ev.stopPropagation());
            } else {
                moreEl.hidden = true;
            }
        });
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
