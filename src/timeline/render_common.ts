import {TweetCard, TweetContent} from "./tweet_entry";
import {setTweetCatFlag} from "./route_helper";


// ==== types & tiny utils ====
export type Piece = { start: number; end: number; html: string };

export const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
export function isLargeCard(card: TweetCard): boolean {
    const first = card.images?.[0];
    const wide = first?.width && first?.height ? first.width / first.height >= 1.5 : false;
    return /\bsummary_large_image\b/i.test(card.name || "") || !!wide;
}

export function extractDomain(vanity?: string, fallback?: string): string {
    if (!vanity && !fallback) return '';
    try {
        const u = vanity && /^https?:\/\//i.test(vanity) ? new URL(vanity) : (vanity ? new URL(`https://${vanity}`) : null);
        const host = u?.hostname || '';
        return (host || fallback || '').replace(/^www\./, '').replace(/^https?:\/\//, '');
    } catch {
        return (fallback || '').replace(/^https?:\/\//, '');
    }
}

export function isTwitterStatusUrl(href: string | undefined): boolean {
    if (!href) return false;
    try {
        const u = new URL(href);
        const host = u.hostname.toLowerCase();
        if (host !== 'twitter.com' && host !== 'www.twitter.com' &&
            host !== 'x.com' && host !== 'www.x.com') return false;
        return /\/[^/]+\/status\/\d+/.test(u.pathname);
    } catch { return false; }
}


/* ---------- helpers ---------- */
export function plain(txt: string): string {
    return escapeHTML(txt).replace(/\n/g, '<br>');
}

/* ---------- tiny utils ---------- */
export function escapeHTML(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function getHiddenMediaShortUrls(tweet: TweetContent): Set<string> {
    const set = new Set<string>();
    const mediaArr = tweet.extended_entities?.media ?? [];
    for (const m of mediaArr) {
        if (m?.url) set.add(m.url);
    }
    return set;
}


export function collectUrlPiecesWithHiddenSet(
    tweet: TweetContent,
    full: string,
    visibleS: number,
    visibleE: number,
    hiddenShortUrls: Set<string>
): Piece[] {
    const arr = tweet.entities?.urls ?? [];

    // 小工具：判断“空白”（空格/制表/换行）
    const isWS = (ch: string) => ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r' || ch === '\f';

    return arr.flatMap(u => {
        let s = clamp(u.indices?.[0] ?? 0, 0, full.length);
        let e = clamp(u.indices?.[1] ?? 0, 0, full.length);
        if (e <= visibleS || s >= visibleE) return [];

        if (u?.url && hiddenShortUrls.has(u.url)) {
            // 向左吃掉前导空白
            while (s > visibleS && isWS(full[s - 1])) s--;
            // 向右吃掉后缀空白
            while (e < visibleE && isWS(full[e])) e++;
            return [{start: s, end: e, html: ''}];
        }

        // ✅ 正常链接：href 用 t.co，label 用 display_url，title 用 expanded_url
        const href = u.url ?? u.expanded_url ?? '';
        const label = u.display_url ?? href;
        const title = u.expanded_url ?? href;

        return [{
            start: s,
            end: e,
            html:
                `<a class="url" href="${escapeHTML(href)}" target="_blank" rel="noopener noreferrer" ` +
                `title="${escapeHTML(title)}" data-expanded-url="${escapeHTML(title)}">` +
                `${escapeHTML(label)}` +
                `</a>`
        }];
    });
}

export function bindTwitterInternalLink(element: HTMLAnchorElement, path: string) {
    if (element.dataset.hasProtected === 'true') return;

    element.href = path;
    element.addEventListener('click', (e) => {
        // 避免修饰键（如 Ctrl+Click / Cmd+Click）破坏行为
        if (
            e.defaultPrevented ||
            e.button !== 0 || // 非左键点击
            e.metaKey || e.ctrlKey || e.shiftKey || e.altKey
        ) return;

        // console.log("-------------->>>>>>", element, path)
        e.preventDefault();
        setTweetCatFlag(true);
        history.pushState({fromTweetCat: true}, '', path);
        dispatchEvent(new PopStateEvent('popstate'));
    });
    element.dataset.hasProtected = 'true';
}
