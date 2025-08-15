import {TweetCard} from "./tweet_entry";
import {
    bindTwitterInternalLink,
    extractDomain,
    isTwitterStatusUrl
} from "./render_common";

/** 入口：渲染卡片区域 */
export function updateTweetCardArea(
    container: HTMLElement,
    card: TweetCard | null,
    tpl: HTMLTemplateElement,
): void {
    if (!container) return;
    container.innerHTML = "";
    if (!card) return;

    const tplId = pickTemplateId(card);
    const node = cloneTemplate(tpl, tplId);
    if (!node) return;

    const root = node.querySelector("a.inline-link-card") as HTMLAnchorElement | null;
    if (!root) return;

    configureAnchor(root, card);

    fillTexts(node, card);

    applyImage(node, card);

    togglePlayerOverlay(node, card);

    container.appendChild(node);
}

/** 选择模板：player 一律 small；summary_large_image 有图才 large；其它非 summary/非 player 且有图 → large */
function pickTemplateId(card: TweetCard): string {
    const isSummary = card.name === "summary";
    const isPlayer = card.name === "player";
    const isSli = card.name === "summary_large_image";

    const first = card.images?.[0];
    const hasImage = !!(card.mainImageUrl || first?.url);

    let preferLarge = false;
    if (isSli && hasImage) {
        preferLarge = true;
    } else if (!isSummary && !isPlayer && hasImage) {
        preferLarge = true;
    }

    return preferLarge ? "tpl-inline-link-card--large" : "tpl-inline-link-card--small";
}

/** 从模板克隆节点（带空值保护） */
function cloneTemplate(tpl: HTMLTemplateElement, id: string): HTMLElement | null {
    const base = tpl.content.getElementById(id);
    if (!base) return null;
    const node = base.cloneNode(true) as HTMLElement;
    node.removeAttribute("id");
    return node;
}

/** 配置链接与内部路由 */
function configureAnchor(root: HTMLAnchorElement, card: TweetCard): void {
    const hrefTco = card.url || card.vanityUrl || "#";
    const expanded = card.expandedUrl || card.vanityUrl || "";

    root.href = hrefTco;
    root.target = "_blank";
    root.rel = "noopener noreferrer";

    if (expanded) root.dataset.expandedUrl = expanded;

    if (expanded && isTwitterStatusUrl(expanded)) {
        try {
            bindTwitterInternalLink(root, expanded);
            root.removeAttribute("target");
            root.removeAttribute("rel");
        } catch {
            /* ignore */
        }
    }
}

/** 写入标题 / 描述 / 域名 */
function fillTexts(node: HTMLElement, card: TweetCard): void {
    const title = card.title || card.domain || card.vanityUrl || "";
    const desc = card.description || "";
    const domainText = extractDomain(card.vanityUrl, card.domain);

    const titleEl = node.querySelector(".title") as HTMLElement | null;
    if (titleEl) titleEl.textContent = title;

    const descEl = node.querySelector(".js-card-desc") as HTMLElement | null;
    if (descEl) {
        if (desc) {
            descEl.textContent = desc;
            descEl.style.display = "";
        } else {
            descEl.style.display = "none";
        }
    }

    const domainEl = node.querySelector(".js-card-domain") as HTMLElement | null;
    if (domainEl) {
        if (domainText) {
            domainEl.textContent = domainText;
            domainEl.style.display = "";
        } else {
            domainEl.style.display = "none";
        }
    }
}

/** 应用图片（不存在则隐藏缩略图容器） */
function applyImage(node: HTMLElement, card: TweetCard): void {
    const imgWrap = node.querySelector(".thumb") as HTMLElement | null;
    const imgEl = node.querySelector(".card-img") as HTMLImageElement | null;

    if (!imgWrap || !imgEl) return;

    const first = card.images?.[0];
    const imageUrl = card.mainImageUrl || first?.url || "";

    if (!imageUrl) {
        imgWrap.style.display = "none";
        return;
    }

    const title = card.title || card.domain || card.vanityUrl || "";
    const domainText = extractDomain(card.vanityUrl, card.domain);

    imgEl.src = imageUrl;
    imgEl.alt = title || domainText || "link preview";
    imgEl.loading = "lazy";
    imgEl.decoding = "async";

    if (first?.width) (imgEl as any).width = first.width;
    if (first?.height) (imgEl as any).height = first.height;

    imgWrap.style.display = "";
}

/** 播放浮层（模板里存在就按需显示） */
function togglePlayerOverlay(node: HTMLElement, card: TweetCard): void {
    const playIcon = node.querySelector(".card-play-icon") as HTMLElement | null;
    if (!playIcon) return;

    const shouldShow = card.name === "player";
    playIcon.style.display = shouldShow ? "" : "none";
}
