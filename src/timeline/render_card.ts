import {TweetCard} from "./tweet_entry";
import {
    bindTwitterInternalLink,
    extractDomain,
    isLargeCard,
    isTwitterStatusUrl
} from "./render_common";


export function updateTweetCardArea(
    container: HTMLElement,
    card: TweetCard | null,
    _tpl: HTMLTemplateElement,
): void {
    if (!container) return;
    container.innerHTML = "";
    if (!card) return;

    const base = _tpl.content.getElementById('tpl-inline-link-card');
    if (!base) return;
    const node = base.cloneNode(true) as HTMLElement;
    node.removeAttribute('id');

    const root = node.querySelector('a.inline-link-card') as HTMLAnchorElement;

    // === 链接与 expanded ===
    const hrefTco = card.url || card.vanityUrl || "#";
    const expanded = card.expandedUrl || card.vanityUrl || '';
    root.href = hrefTco;
    root.target = "_blank";
    root.rel = "noopener noreferrer";
    if (expanded) root.dataset.expandedUrl = expanded;

    // 推文内部路由
    if (expanded && isTwitterStatusUrl(expanded)) {
        try {
            bindTwitterInternalLink(root, expanded);
            root.removeAttribute('target');
            root.removeAttribute('rel');
        } catch {}
    }

    // === 标题 / 描述 / 域名 ===
    const title = card.title || card.domain || card.vanityUrl || "";
    const desc = card.description || "";
    const domainText = extractDomain(card.vanityUrl, card.domain);
    (node.querySelector('.title') as HTMLElement).textContent = title;

    const descEl = node.querySelector('.js-card-desc') as HTMLElement;
    if (desc) {
        descEl.textContent = desc;
        descEl.style.display = '';
    } else {
        descEl.style.display = 'none';
    }

    const domainEl = node.querySelector('.js-card-domain') as HTMLElement;
    if (domainText) {
        domainEl.textContent = domainText;
        domainEl.style.display = '';
    } else {
        domainEl.style.display = 'none';
    }

    // === 图片处理 ===
    const imgWrap = node.querySelector('.thumb') as HTMLElement;
    const imgEl = node.querySelector('.card-img') as HTMLImageElement;

    const first = card.images?.[0];
    const imageUrl = card.mainImageUrl || first?.url || '';

    if (imageUrl) {
        imgEl.src = imageUrl;
        imgEl.alt = title || domainText || 'link preview';
        imgEl.loading = 'lazy';
        imgEl.decoding = 'async';
        if (first?.width) (imgEl as any).width = first.width;
        if (first?.height) (imgEl as any).height = first.height;
        imgWrap.style.display = '';
    } else {
        imgWrap.style.display = 'none';
    }

    // === 大卡片样式 ===
    if (isLargeCard(card)) root.classList.add('inline-link-card--large');

    // === 播放器浮层逻辑（新规则：有 expandedUrl 且有图就显示） ===
    const playIcon = node.querySelector('.card-play-icon') as HTMLElement;
    const shouldShowPlayer = !!(expanded && imageUrl);
    playIcon.style.display = shouldShowPlayer ? '' : 'none';

    container.appendChild(node);
}
