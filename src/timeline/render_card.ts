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
    console.log("[TweetCard DEBUG]", card);
    if (!container) return;
    container.innerHTML = "";
    if (!card) return;

    const tplId = pickTemplateId(card);
    const node = cloneTemplate(tpl, tplId);
    if (!node) return;

    // ⬇️ large 结构与 small 不同，这里分支
    if (tplId === "tpl-card-large") {
        renderLargeCard(node, card);   // 新增：见③
    } else if (tplId === "tpl-inline-link-card--restricted") {
        console.log("------>>> baned content：", card)
    } else if (tplId === "tpl-inline-link-card--poll") {
        console.log("------>>> poll card ::TO DO:：", card)
    } else {
        const root = node.querySelector("a.inline-link-card") as HTMLAnchorElement | null;
        if (!root) return;

        configureAnchor(root, card);   // 仍然只给 small 用
        fillTexts(node, card);         // small 用
        applyImage(node, card);        // small 用
        togglePlayerOverlay(node, card);
    }

    container.appendChild(node);
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

function pickTemplateId(card: TweetCard): string {

    const noContent =
        !card.title &&
        !card.description &&
        !card.domain &&
        !(card.images?.length);

    if (card.name === "unified_card" && noContent) {
        return "tpl-inline-link-card--restricted";
    }

    if (card.name && card.name.startsWith("poll")) {
        return "tpl-inline-link-card--poll";
    }

    const isSummary = card.name === "summary";
    const isPlayer = card.name === "player";
    const isSli = card.name === "summary_large_image";

    const first = card.images?.[0];
    const hasImage = !!(card.mainImageUrl || first?.url);

    const preferLarge =
        (isSli && hasImage) ||
        (!isSummary && !isPlayer && hasImage);

    // ⬇️ large 用新模板 ID
    return preferLarge ? "tpl-card-large" : "tpl-inline-link-card--small";
}


/** 播放浮层（模板里存在就按需显示） */
function togglePlayerOverlay(node: HTMLElement, card: TweetCard): void {
    const playIcon = node.querySelector(".card-play-icon") as HTMLElement | null;
    if (!playIcon) return;

    const shouldShow = card.name === "player";
    playIcon.style.display = shouldShow ? "" : "none";
}

function renderLargeCard(node: HTMLElement, card: TweetCard): void {
    const hrefTco = card.url || card.vanityUrl || "#";
    const expanded = card.expandedUrl || card.vanityUrl || "";
    const title = card.title || card.domain || card.vanityUrl || "";
    const domain = extractDomain(card.vanityUrl, card.domain);
    const first = card.images?.[0];
    const imageUrl = card.mainImageUrl || first?.url || "";

    // anchor：大图点击区
    const aMedia = node.querySelector(".tc-card-large__media") as HTMLAnchorElement | null;
    // anchor：底部“来自 domain”
    const aSource = node.querySelector(".tc-card-large__source") as HTMLAnchorElement | null;

    if (aMedia) {
        aMedia.href = hrefTco;
        aMedia.target = "_blank";
        aMedia.rel = "noopener noreferrer";
        if (expanded) (aMedia as any).dataset.expandedUrl = expanded;

        // 仅对 status 链接走内部路由
        if (expanded && isTwitterStatusUrl(expanded)) {
            try {
                bindTwitterInternalLink(aMedia, expanded);
                aMedia.removeAttribute("target");
                aMedia.removeAttribute("rel");
            } catch { /* ignore */
            }
        }
    }

    if (aSource) {
        aSource.href = hrefTco;
        aSource.target = "_blank";
        aSource.rel = "noopener noreferrer";
        if (expanded) (aSource as any).dataset.expandedUrl = expanded;
    }

    // 文本：标题（覆盖在图上） & 底部域名
    const titleEl = node.querySelector(".tc-card-large__title") as HTMLElement | null;
    if (titleEl) titleEl.textContent = title;

    const srcText = node.querySelector(".tc-card-large__source-text") as HTMLElement | null;
    if (srcText) srcText.textContent = domain || "";

    // 图片：img + 背景（占位/模糊底）
    const imgEl = node.querySelector(".tc-card-large__img") as HTMLImageElement | null;
    const bgEl = node.querySelector(".tc-card-large__bg") as HTMLElement | null;

    if (imgEl && imageUrl) {
        imgEl.src = imageUrl;
        imgEl.alt = title || domain || "link preview";
        imgEl.loading = "lazy";
        imgEl.decoding = "async";
    }
    if (bgEl && imageUrl) {
        bgEl.style.backgroundImage = `url("${imageUrl}")`;
    }
}
