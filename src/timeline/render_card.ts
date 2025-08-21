import {TweetCard} from "./tweet_entry";
import {
    bindTwitterInternalLink,
    isTwitterStatusUrl
} from "./render_common";
import {logRender} from "../common/debug_flags";
import {isXArticle} from "../common/utils";

// 补协议
function absHttp(u?: string): string {
    if (!u) return '';
    return /^https?:\/\//i.test(u) ? u : `https://${u}`;
}

// 仅当 expanded 是“可信可绕过 t.co”时返回 true：
// 规则：站内(x.com/twitter.com)一律允许；外站必须带 path 或 query
function canBypassTco(expandedAbs: string, cardName?: string): boolean {
    if (!expandedAbs) return false;
    try {
        const u = new URL(expandedAbs);
        const host = u.hostname.toLowerCase();
        const isInternal = host.endsWith('x.com') || host.endsWith('twitter.com');
        const hasPathOrQuery = (u.pathname && u.pathname !== '/') || !!u.search;

        if (isInternal) return true;
        if (cardName === 'player') return true; // 播放器类通常有完整 URL，可直达
        return hasPathOrQuery;                  // 外站必须带具体路径/参数才绕过
    } catch {
        return false;
    }
}

function extractDomain(vanity?: string, fallback?: string): string {
    if (!vanity && !fallback) return '';
    try {
        const u = vanity && /^https?:\/\//i.test(vanity) ? new URL(vanity) : (vanity ? new URL(`https://${vanity}`) : null);
        const host = u?.hostname || '';
        return (host || fallback || '').replace(/^www\./, '').replace(/^https?:\/\//, '');
    } catch {
        return (fallback || '').replace(/^https?:\/\//, '');
    }
}

/** 入口：渲染卡片区域 */
export function updateTweetCardArea(
    container: HTMLElement,
    card: TweetCard | null,
    tpl: HTMLTemplateElement,
): void {
    logRender("[TweetCard DEBUG]", card);
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
        logRender("------>>> baned content：", card)
    } else if (tplId === "tpl-inline-link-card--poll") {
        logRender("------>>> poll card ::TO DO:：", card)
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

function configureAnchor(root: HTMLAnchorElement, card: TweetCard): void {
    // 先用 t.co，其次 expandedUrl，最后 vanityUrl；都补成绝对 URL
    const expandedRaw = card.expandedUrl || "";
    const href =
        (/^https?:\/\/t\.co\//i.test(card.url) ? card.url : "") ||
        absHttp(expandedRaw) ||
        absHttp(card.vanityUrl) ||
        "#";

    root.href = href;
    root.target = "_blank";
    root.rel = "noopener noreferrer";

    // 只看 expandedUrl 本身是否“可信”；不要再用 vanityUrl 兜底去写 dataset
    const expandedAbs = absHttp(expandedRaw);
    if (canBypassTco(expandedAbs, card.name)) {
        root.dataset.expandedUrl = expandedAbs;
    } else {
        // 确保没有残留（防止复用节点造成误跳）
        delete (root as any).dataset.expandedUrl;
    }

    if (expandedAbs && isTwitterStatusUrl(expandedAbs)) {
        try {
            bindTwitterInternalLink(root, expandedAbs);
            root.removeAttribute("target");
            root.removeAttribute("rel");
        } catch { /* ignore */
        }
    }

    logRender('[card.href.pick]', {
        name: card.name,
        url: card.url,
        expandedUrl: card.expandedUrl,
        vanityUrl: card.vanityUrl,
        finalHref: href,
        datasetExpanded: canBypassTco(absHttp(card.expandedUrl || ""), card.name) ? absHttp(card.expandedUrl || "") : ''
    });
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
    const cardImgFallback = node.querySelector(".card-img-fallback") as HTMLElement | null;

    if (!imgWrap || !imgEl || !cardImgFallback) return;

    const first = card.images?.[0];
    const imageUrl = card.mainImageUrl || first?.url || "";

    if (!imageUrl) {
        imgEl.style.display = "none";
        cardImgFallback.style.display = "block";
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
    const expandedRaw = card.expandedUrl || "";
    const title = card.title || card.domain || card.vanityUrl || "";
    const domain = extractDomain(card.vanityUrl, card.domain);
    const first = card.images?.[0];
    const imageUrl = card.mainImageUrl || first?.url || "";

    // ① 保持你的模式切换逻辑
    const expandedAbsForMode = absHttp(expandedRaw);
    const isXArticleCard = isXArticle(expandedAbsForMode || "");

    const root = node as HTMLElement;
    root.classList.toggle("tc-card-large--text", isXArticleCard);
    root.classList.toggle("tc-card-large--overlay", !isXArticleCard);
    root.classList.toggle("tc-card-large--hide-source", isXArticleCard);

    // ===== ② anchor：大图点击区 =====
    const href =
        (/^https?:\/\/t\.co\//i.test(card.url) ? card.url : "") ||
        absHttp(expandedRaw) ||
        absHttp(card.vanityUrl) ||
        "#";
    const expandedAbs = absHttp(expandedRaw);

    const aMedia = node.querySelector(".tc-card-large__media") as HTMLAnchorElement | null;
    const aSource = node.querySelector(".tc-card-large__source") as HTMLAnchorElement | null;

    if (aMedia) {
        aMedia.href = href;
        aMedia.removeAttribute("target");        // 交给 wireCardAnchor/浏览器
        aMedia.rel = "noopener noreferrer";
        if (canBypassTco(expandedAbs, card.name)) {
            (aMedia as any).dataset.expandedUrl = expandedAbs;
        } else {
            delete (aMedia as any).dataset.expandedUrl;
        }
    }

    if (aSource) {
        aSource.href = href;
        aSource.target = "_blank";
        aSource.rel = "noopener noreferrer";
        if (canBypassTco(expandedAbs, card.name)) {
            (aSource as any).dataset.expandedUrl = expandedAbs;
        } else {
            delete (aSource as any).dataset.expandedUrl;
        }
    }

    // ===== ③ 文本：覆盖在图上的标题 与 底部域名 =====
    const titleOverlay = node.querySelector(".tc-card-large__media .tc-card-large__title") as HTMLElement | null;
    if (titleOverlay) titleOverlay.textContent = title;

    const srcText = node.querySelector(".tc-card-large__source-text") as HTMLElement | null;
    if (srcText) srcText.textContent = domain || "";

    // ===== ④ 文本块模式下的标题/描述（图下方） =====
    if (isXArticleCard) {
        const titleBelow = node.querySelector(".tc-card-large__title-text") as HTMLElement | null;
        if (titleBelow) titleBelow.textContent = title;
    }

    const descSelector = isXArticleCard
        ? ".tc-card-large__meta .tc-card-large__desc"      // 站内：用 meta 的描述
        : ".tc-card-large__caption .tc-card-large__desc";   // 站外：用 caption 的描述

    const descEl = node.querySelector(descSelector) as HTMLElement | null;
    if (descEl) {
        const desc = card.description || "";
        if (isXArticleCard && desc) {
            // 站内：有描述就显示
            descEl.textContent = desc;
            descEl.style.display = "";
        } else {
            // 站外或无描述：不显示
            descEl.textContent = "";
            descEl.style.display = "none";
        }
    }

    // ===== ⑤ 图片：img + 背景（占位/模糊底） =====
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


    logRender('[card.href.pick]', {
        name: card.name,
        url: card.url,
        expandedUrl: card.expandedUrl,
        vanityUrl: card.vanityUrl,
        finalHref: href
    });
}
