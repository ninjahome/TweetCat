import {EntryObj, TweetAuthor, TweetContent} from "./object_tweet";

export function renderTweetsBatch(entries: EntryObj[], contentTemplate: HTMLTemplateElement): DocumentFragment {
    const fragment = document.createDocumentFragment();

    entries.forEach((entry, index) => {
        const tweetNode = renderTweetHTML(index, entry, contentTemplate);
        fragment.appendChild(tweetNode);
    });

    return fragment;
}

export function renderTweetHTML(index: number, tweetEntry: EntryObj, tpl: HTMLTemplateElement, estimatedHeight: number = 350): HTMLElement {
    const tweetCellDiv = tpl.content.getElementById("tweetCellTemplate")!.cloneNode(true) as HTMLDivElement;
    tweetCellDiv.style.transform = `translateY(${index * estimatedHeight}px)`;
    tweetCellDiv.setAttribute('id', "");

    const article = tweetCellDiv.querySelector('article[data-testid="tweet"]');
    if (!article) return tweetCellDiv;

    const outer = tweetEntry.tweet;              // A 转推 B ——> outer = A
    const target = outer.renderTarget;      // 若转推则是 B，否则还是 A

    updateTweetAvatar(article, outer.author, tpl);
    updateTweetTopButtonArea(article, outer.author, outer.tweetContent.created_at, outer.rest_id, tpl);

    // 3. 若是转推 ➜ 在顶部插入 “@outer.author.displayName reposted”
    if (outer.retweetedStatus) {
        insertRepostedBanner(article, outer.author, tpl);   // 你自己的函数
    }

    // 4. 正文文本 = target.tweetContent.full_text  (注意 entity 等都用 target)
    updateTweetContentArea(article, target.tweetContent, tpl);

    return tweetCellDiv;
}

// 工具函数：获取高清头像链接
function getHighResAvatarUrl(url: string): string {
    return url.replace('_normal', '_400x400');
}

// 渲染头像模块
export function updateTweetAvatar(container: Element, author: TweetAuthor, contentTemplate: HTMLTemplateElement): void {
    const avatarTemplate = contentTemplate.content.getElementById('Tweet-User-Avatar') as HTMLElement;
    if (!avatarTemplate) return;

    const avatarClone = avatarTemplate.cloneNode(true) as HTMLElement;
    avatarClone.removeAttribute('id');

    const highResUrl = getHighResAvatarUrl(author.legacy.profile_image_url_https);

    const img = avatarClone.querySelector('img') as HTMLImageElement;
    if (img) {
        img.src = highResUrl;
        img.alt = author.legacy.displayName;
    }

    const bgDiv = avatarClone.querySelector('div[style*="background-image"]') as HTMLDivElement;
    if (bgDiv) {
        bgDiv.style.backgroundImage = `url(${highResUrl})`;
    }

    const link = avatarClone.querySelector('a') as HTMLAnchorElement;
    if (link) {
        link.href = `/${author.legacy.screenName}`;
    }

    const wrapper = avatarClone.querySelector('[data-testid^="UserAvatar-Container"]');
    if (wrapper) {
        wrapper.setAttribute('data-testid', `UserAvatar-Container-${author.legacy.screenName}`);
    }

    const avatarContainer = container.querySelector(".Tweet-User-Avatar");
    if (avatarContainer) {
        avatarContainer.innerHTML = '';
        avatarContainer.appendChild(avatarClone);
    }
}


// 渲染顶部昵称、用户名、发布时间区域
export function updateTweetTopButtonArea(container: Element, author: TweetAuthor, createdAt: string, tweetId: string, contentTemplate: HTMLTemplateElement): void {
    const topButtonTemplate = contentTemplate.content.getElementById('top-button-area-template') as HTMLElement;
    if (!topButtonTemplate) return;

    const topButtonClone = topButtonTemplate.cloneNode(true) as HTMLElement;
    topButtonClone.removeAttribute('id');

    // 更新昵称（大号）区域
    const userNameLink = topButtonClone.querySelector('[data-testid="User-Name"] a') as HTMLAnchorElement;
    if (userNameLink) {
        userNameLink.href = `/${author.legacy.screenName}`;
        const nameSpan = userNameLink.querySelector('span span');
        if (nameSpan) nameSpan.textContent = author.legacy.displayName;
    }

    // 更新小号 (@xxx)
    const screenNameLink = topButtonClone.querySelector('a[tabindex="-1"]') as HTMLAnchorElement;
    if (screenNameLink) {
        screenNameLink.href = `/${author.legacy.screenName}`;
        const screenNameSpan = screenNameLink.querySelector('span');
        if (screenNameSpan) screenNameSpan.textContent = `@${author.legacy.screenName}`;
    }

    // 更新时间
    const timeLink = topButtonClone.querySelector('a[href*="/status/"]') as HTMLAnchorElement;
    if (timeLink) {
        timeLink.href = `/${author.legacy.screenName}/status/${tweetId}`;
        const date = new Date(createdAt);
        const timeElement = timeLink.querySelector('time');
        if (timeElement) {
            timeElement.setAttribute('datetime', date.toISOString());
            timeElement.textContent = formatTweetTime(createdAt);
        }
    }

    // 动态处理认证图标是否显示
    const verifiedIcon = topButtonClone.querySelector('svg[data-testid="icon-verified"]');
    if (verifiedIcon && !author.is_blue_verified) {
        verifiedIcon.remove();
    }

    // 安全赋值内容
    const topArea = container.querySelector(".Tweet-Body .top-button-area");
    if (topArea) {
        topArea.innerHTML = '';
        topArea.appendChild(topButtonClone);
    }
}


/**
 * Friendly time‑ago / date stamp — mirrors Twitter UI behaviour.
 *   • < 60 s   →  "xs ago" / "x秒前"
 *   • < 60 min →  "xm ago" / "x分钟前"
 *   • < 24 h   →  "xh ago" / "x小时前"
 *   • < 7 d    →  "xd ago" / "x天前"
 *   • ≥ 7 d    →  "May 5" / "5月5日"
 */
export function formatTweetTime(
    dateString: string,
    locale: 'auto' | 'zh' | 'en' = 'auto',
): string {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);

    // 自动侦测语言
    let finalLocale = locale;
    if (locale === 'auto') {
        const lang = (navigator.language || 'en').toLowerCase();
        finalLocale = lang.startsWith('zh') ? 'zh' : 'en';
    }

    if (diffSeconds < 60) {
        return finalLocale === 'zh' ? `${diffSeconds}秒` : `${diffSeconds}s`;
    }
    if (diffMinutes < 60) {
        return finalLocale === 'zh' ? `${diffMinutes}分钟` : `${diffMinutes}m`;
    }
    if (diffHours < 24) {
        return finalLocale === 'zh' ? `${diffHours}小时` : `${diffHours}h`;
    }
    if (diffDays < 7) {
        return finalLocale === 'zh' ? `${diffDays}天` : `${diffDays}d`;
    }
    // ≥ 7 天: 显示具体年月日（Twitter 也会在跨年时带年份；此处简化按当年处理）
    if (finalLocale === 'zh') {
        return `${date.getMonth() + 1}月${date.getDate()}日`;
    }
    return date.toLocaleDateString('en-US', {month: 'short', day: 'numeric'});
}

export function updateTweetContentArea(
    container: Element,
    tweet: TweetContent,
    template: HTMLTemplateElement,
): string | undefined {
    /* ---------- 0. 基础 DOM ---------- */
    const textTpl = template.content.getElementById('tweet-text-area-template') as HTMLElement | null;
    if (!textTpl) return;

    const textClone = textTpl.cloneNode(true) as HTMLElement;
    textClone.removeAttribute('id');
    const span = textClone.querySelector('span');
    if (!span) return;

    /* ---------- 1. 判断是否为 Retweet ---------- */
    let repostAuthorHandle: string | undefined;
    let visible = tweet.full_text;
    const m = /^RT\s+@(\w+):\s+/u.exec(visible);
    if (m) {
        repostAuthorHandle = m[1];
        visible = visible.slice(m[0].length);
    }

    /* ---------- 2. 使用 display_text_range 裁剪 ---------- */
    const cps = [...visible];
    const [start, end] = tweet.display_text_range;
    visible = cps.slice(start, end).join('');

    /* ---------- 3. 收集 media 占位短链 ---------- */
    const mediaTco = new Set<string>();
    tweet.extended_entities?.media?.forEach(m => mediaTco.add(m.url));

    /* ---------- 4. 移除正文中的 media t.co 占位 ---------- */
    if (mediaTco.size) {
        mediaTco.forEach(u => {
            const re = new RegExp(`\\s*${escapeRegExp(u)}\\s*`, 'g');
            visible = visible.replace(re, '');
        });
    }

    /* ---------- 5. 构建实体映射 ---------- */
    type Piece = { start: number; end: number; html: string };
    const pieces: Piece[] = [];

    tweet.entities.user_mentions.forEach(u =>
        pieces.push({
            start: u.indices[0],
            end: u.indices[1],
            html: `<a href="/${u.screen_name}" class="mention">@${u.screen_name}</a>`
        }),
    );
    tweet.entities.hashtags.forEach(h =>
        pieces.push({
            start: h.indices[0],
            end: h.indices[1],
            html: `<a href="/hashtag/${h.text}" class="hashtag">#${h.text}</a>`
        }),
    );

    // URL – 过滤 media 及裸短链
    tweet.entities.urls.forEach(u => {
        if (mediaTco.has(u.url)) return; // media 占位
        const isBareTco = /^https?:\/\/t\.co\/[A-Za-z0-9]+$/u.test(u.expanded_url ?? u.url);
        if (isBareTco) return;

        pieces.push({
            start: u.indices[0],
            end: u.indices[1],
            html: `<a href="${u.expanded_url}" class="url" target="_blank" rel="noopener noreferrer">${escapeHTML(u.display_url)}</a>`,
        });
    });

    /* ---------- 6. 拼装 HTML ---------- */
    pieces.sort((a, b) => a.start - b.start);
    const out: string[] = [];
    let last = 0;
    for (const p of pieces) {
        if (last < p.start) out.push(plain(visible.slice(last, p.start)));
        out.push(p.html);
        last = p.end;
    }
    if (last < visible.length) out.push(plain(visible.slice(last)));

    span.innerHTML = out.join('');

    /* ---------- 7. 注入 ---------- */
    const target = container.querySelector('.tweet-text-area');
    if (target) {
        target.innerHTML = '';
        target.appendChild(textClone);
    }

    return repostAuthorHandle;

    /* ---------- helpers ---------- */
    function plain(txt: string): string {
        return escapeHTML(txt).replace(/\n/g, '<br>');
    }
}

/* ---------- tiny utils ---------- */
function escapeHTML(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}


export function insertRepostedBanner(
    article: Element,
    author: TweetAuthor,
    tpl: HTMLTemplateElement,
): void {
    // ① 找占位 <div class="tweetCatTopTipsArea …">
    const host = article.querySelector('.tweetCatTopTipsArea') as HTMLElement | null;
    if (!host) return;

    // ② 克隆模板内部结构
    const raw = tpl.content.getElementById('tweetCatTopTipsArea') as HTMLElement | null;
    if (!raw) return;
    const banner = raw.cloneNode(true) as HTMLElement;
    banner.removeAttribute('id');

    // ③ 注入动态数据
    const a = banner.querySelector('a.retweetUserName') as HTMLAnchorElement | null;
    if (a) a.href = `/${author.legacy.screenName}`;
    const disp = banner.querySelector('.retweetDisplayName');
    if (disp) disp.textContent = author.legacy.displayName;

    // ⑤ 清掉旧内容并塞入 banner
    host.innerHTML = '';
    host.appendChild(banner);
}
