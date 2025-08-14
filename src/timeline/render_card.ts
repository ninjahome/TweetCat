import {TweetCard} from "./tweet_entry";
import {bindTwitterInternalLink, extractDomain, isLargeCard, isTwitterStatusUrl, normalizeUrl} from "./render_common";

export function updateTweetCardArea(
    container: HTMLElement,
    card: TweetCard | null,
    _tpl: HTMLTemplateElement,
): void {
    if (!container) return;
    container.innerHTML = "";
    if (!card) return;

    const node = _tpl.content.getElementById( 'tpl-inline-link-card')?.cloneNode(true) as HTMLElement;
    node.removeAttribute('id');
    const root = node.querySelector('a.inline-link-card') as HTMLAnchorElement;

    // 链接与扩展信息
    const hrefTco = card.url || card.vanityUrl || "#";
    const expanded = normalizeUrl(card.vanityUrl);
    root.href = hrefTco;
    root.target = "_blank";
    root.rel = "noopener noreferrer";
    if (expanded) root.dataset.expandedUrl = expanded;

    // 若是推文链接，走内部路由
    if (expanded && isTwitterStatusUrl(expanded)) {
        try {
            const u = new URL(expanded);
            root.removeAttribute('target');
            root.removeAttribute('rel');
            bindTwitterInternalLink(root, u.pathname);
        } catch {}
    }

    // 标题 / 描述 / 域名
    const title = card.title || card.domain || card.vanityUrl || "";
    const desc = card.description || "";
    const domainText = extractDomain(card.vanityUrl, card.domain);
    (node.querySelector('.title') as HTMLElement).textContent = title;

    const descEl = node.querySelector('.js-card-desc') as HTMLElement;
    if (desc) { descEl.textContent = desc; descEl.style.display = ''; }
    else { descEl.style.display = 'none'; }

    const domainEl = node.querySelector('.js-card-domain') as HTMLElement;
    if (domainText) { domainEl.textContent = domainText; domainEl.style.display = ''; }
    else { domainEl.style.display = 'none'; }

    // 图片（直接使用，不做域名判断）
    const imgWrap = node.querySelector('.thumb') as HTMLElement;
    const imgEl = node.querySelector('.card-img') as HTMLImageElement;
    if (card.mainImageUrl) {
        imgEl.src = card.mainImageUrl!;
        imgEl.alt = title || domainText || 'link preview';
        imgEl.loading = 'lazy';
        imgEl.decoding = 'async';
        const first = card.images?.[0];
        if (first?.width) (imgEl as any).width = first.width;
        if (first?.height) (imgEl as any).height = first.height;
        imgWrap.style.display = '';
    } else {
        imgWrap.style.display = 'none';
    }

    // small / large 切换
    if (isLargeCard(card)) root.classList.add('inline-link-card--large');

    // 播放器浮层显示
    const playIcon = node.querySelector('.card-play-icon') as HTMLElement;
    if (/\bplayer\b/i.test(card.name || '') && card.mainImageUrl) {
        playIcon.style.display = '';
    } else {
        playIcon.style.display = 'none';
    }

    container.appendChild(node);
}



// function updateTweetCardArea(
//     container: HTMLElement,
//     card: TweetCard | null,
//     _tpl?: HTMLTemplateElement,
// ): void {
//     if (!container) return;
//     container.innerHTML = "";
//     if (!card) return;
//
//     const hrefTco = card.url || card.vanityUrl || "#";          // 点击走 t.co（与官方一致）
//     const expanded = normalizeUrl(card.vanityUrl) || undefined; // 作为 data-expanded-url
//
//     const title = card.title || card.domain || card.vanityUrl || "";
//     const desc = card.description || "";
//     const thumb = card.mainImageUrl;
//     const domainText = card.domain?.replace(/^https?:\/\//, "");
//
//     const a = document.createElement("a");
//     a.className = "inline-link inline-link-card";
//     a.href = hrefTco;
//     a.target = "_blank";
//     a.rel = "noopener noreferrer";
//     if (title) a.title = title;
//     if (expanded) a.dataset.expandedUrl = expanded;
//
//     if (thumb) {
//         const thumbWrap = document.createElement("div");
//         thumbWrap.className = "thumb";
//         const img = document.createElement("img");
//         img.src = thumb;
//         img.loading = "lazy";
//         img.alt = title || domainText || "link";
//         thumbWrap.appendChild(img);
//         a.appendChild(thumbWrap);
//     }
//
//     const meta = document.createElement("div");
//     meta.className = "meta";
//
//     const titleDiv = document.createElement("div");
//     titleDiv.className = "title";
//     titleDiv.textContent = title || (card.vanityUrl ?? "");
//     meta.appendChild(titleDiv);
//
//     if (desc) {
//         const descDiv = document.createElement("div");
//         descDiv.className = "desc";
//         descDiv.textContent = desc;
//         meta.appendChild(descDiv);
//     }
//
//     if (domainText) {
//         const domainDiv = document.createElement("div");
//         domainDiv.className = "desc";
//         domainDiv.textContent = domainText;
//         meta.appendChild(domainDiv);
//     }
//
//     a.appendChild(meta);
//     container.appendChild(a);
// }
