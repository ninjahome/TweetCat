import {TweetContent} from "./tweet_entry";
import {logRender} from "../common/debug_flags";

type Piece = { start: number; end: number; html: string };

export function buildCpToCuMap(str: string): number[] {
    const map: number[] = [];
    let cu = 0;
    for (const ch of Array.from(str)) { // 按 code point 迭代
        map.push(cu);
        cu += ch.length;                  // BMP=1，代理对=2
    }
    map.push(cu); // 末尾，便于用作区间右边界
    return map;
}

export function cpRangeToCuClamped(
    cpStart: number | undefined,
    cpEnd: number | undefined,
    cpToCu: number[]
): [number, number] {
    const cpCount = Math.max(0, cpToCu.length - 1);
    const sCP = Math.max(0, Math.min(cpStart ?? 0, cpCount));
    const eCP = Math.max(sCP, Math.min(cpEnd ?? cpCount, cpCount));
    return [cpToCu[sCP], cpToCu[eCP]];
}

// 可见区 [start,end)
function getVisibleRange(tweet: TweetContent, full: string, cpToCu: number[]): [number, number] {
    const r = tweet.display_text_range;
    if (Array.isArray(r) && r.length === 2) {
        // ✅ 把 code point 索引映射成 code unit
        return cpRangeToCuClamped(r[0], r[1], cpToCu);
    }
    return [0, full.length];
}

function collectMentionPieces(
    tweet: TweetContent, full: string, visibleS: number, visibleE: number, cpToCu: number[]
): Piece[] {
    const arr = tweet.entities?.user_mentions ?? [];
    return arr.flatMap(u => {
        const [s, e] = cpRangeToCuClamped(u.indices?.[0], u.indices?.[1], cpToCu);
        if (e <= visibleS || s >= visibleE) return [];
        return [{
            start: s, end: e,
            html: `<a href="/${u.screen_name}" class="mention">@${escapeHTML(u.screen_name)}</a>`
        }];
    });
}

function collectHashtagPieces(
    tweet: TweetContent, full: string, visibleS: number, visibleE: number, cpToCu: number[]
): Piece[] {
    const arr = tweet.entities?.hashtags ?? [];
    return arr.flatMap(h => {
        const [s, e] = cpRangeToCuClamped(h.indices?.[0], h.indices?.[1], cpToCu);
        if (e <= visibleS || s >= visibleE) return [];
        const t = h.text ?? '';
        const urlT = encodeURIComponent(t);
        return [{
            start: s, end: e,
            html: `<a href="/hashtag/${urlT}" class="hashtag">#${escapeHTML(t)}</a>`
        }];
    });
}

function collectUrlPiecesWithHiddenSet(
    tweet: TweetContent,
    full: string,
    visibleS: number,
    visibleE: number,
    hiddenShortUrls: Set<string>,
    cpToCu: number[]
): Piece[] {
    const arr = tweet.entities?.urls ?? [];
    const isWS = (ch: string) =>
        ch === " " || ch === "\n" || ch === "\t" || ch === "\r" || ch === "\f" ||
        ch === "\u00A0" /* NBSP */ || ch === "\u3000" /* 全角空格 */;

    return arr.flatMap(u => {
        if (!u.indices || u.indices.length !== 2) return [];

        // ✅ 把 code point 索引转成 code unit
        const [s0, e0] = cpRangeToCuClamped(u.indices[0], u.indices[1], cpToCu);
        let s = s0, e = e0;

        if (e <= visibleS || s >= visibleE) return [];

        // 向前吞掉前导空白
        while (s > visibleS && isWS(full[s - 1])) s--;
        // 向后吞掉尾随空白
        while (e < visibleE && isWS(full[e])) e++;

        // 如果在隐藏集合里，就不渲染
        if (hiddenShortUrls.has(u.url)) {
            return [];
        }

        const display = escapeHTML(u.display_url ?? u.url);
        const rawHref = u.expanded_url ?? u.url;
        const href = /^https?:\/\//i.test(rawHref) ? rawHref : '#';
        const html = `<a href="${escapeHTML(href)}" class="tweet-url" rel="nofollow noreferrer noopener" target="_blank">${display}</a>`;
        return [{start: s, end: e, html}];
    });
}


// 把 pieces 填回可见区，其他文本用 plain()
function assembleVisibleHtml(full: string, visibleS: number, visibleE: number, pieces: Piece[]): string {
    const sorted = pieces.slice().sort((a, b) => a.start - b.start);
    const out: string[] = [];
    let cur = visibleS;

    for (const p of sorted) {
        const s = Math.max(p.start, visibleS);
        const e = Math.min(p.end, visibleE);
        if (cur < s) out.push(plain(full.slice(cur, s)));
        out.push(p.html);
        cur = e;
    }
    if (cur < visibleE) out.push(plain(full.slice(cur, visibleE)));
    return out.join('');
}

export function updateTweetContentArea(container: HTMLElement, tweet: TweetContent,
                                       opts?: { hiddenShortUrls?: Iterable<string> }) {
    const tweetContent = container.querySelector(".tweet-content") as HTMLElement | null;
    if (!tweetContent) {
        logRender("------>>> tweet content not found:", container);
        return;
    }

    tweetContent.setAttribute('dir', 'auto');
    if (tweet.lang) tweetContent.setAttribute('lang', tweet.lang);

    tweetContent.innerHTML = buildVisibleWithEntitiesHTML(
        tweet,
        opts?.hiddenShortUrls ?? []   // ← 新增
    );
}

export function buildVisibleWithEntitiesHTML(
    tweet: TweetContent,
    extraHiddenShortUrls: Iterable<string> = []
): string {
    const full = tweet.full_text ?? '';
    const cpToCu = buildCpToCuMap(full);             // ✅ 一次性构建映射
    const [start, end] = getVisibleRange(tweet, full, cpToCu);

    const hiddenMedia = getHiddenMediaShortUrls(tweet);
    const hidden = new Set<string>(hiddenMedia);
    for (const u of extraHiddenShortUrls) hidden.add(u);

    const pieces: Piece[] = [];
    pieces.push(...collectMentionPieces(tweet, full, start, end, cpToCu));
    pieces.push(...collectHashtagPieces(tweet, full, start, end, cpToCu));
    pieces.push(...collectUrlPiecesWithHiddenSet(tweet, full, start, end, hidden, cpToCu));

    logRender('[dbg] cpLen=%d, cuLen=%d, visibleCP=%o, visibleCU=%o',
        cpToCu.length - 1,
        full.length,
        tweet.display_text_range,
        [start, end]
    );

    validatePieces(pieces, full, start, end);
    return assembleVisibleHtml(full, start, end, pieces);
}


function getHiddenMediaShortUrls(tweet: TweetContent): Set<string> {
    const set = new Set<string>();
    const mediaArr = tweet.extended_entities?.media ?? [];
    for (const m of mediaArr) {
        if (m?.url) set.add(m.url);
    }
    return set;
}

function escapeHTML(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/* ---------- helpers ---------- */
function plain(txt: string): string {
    return escapeHTML(txt).replace(/\n/g, '<br>');
}

function validatePieces(
    pieces: Piece[],
    full: string,
    start: number,
    end: number
): void {
    for (const p of pieces) {
        if (!(p.start >= start && p.end <= end && p.start <= p.end)) {
            console.warn('[warn] piece out of visible range', p, { start, end });
        }

        // surrogate 检查
        if (p.start > 0) {
            const prev = full.charCodeAt(p.start - 1);
            const cur = full.charCodeAt(p.start);
            if (0xDC00 <= cur && cur <= 0xDFFF && 0xD800 <= prev && prev <= 0xDBFF) {
                console.warn('[warn] piece.start at low-surrogate', p);
            }
        }

        if (p.end > 0) {
            const endPrev = full.charCodeAt(p.end - 1);
            if (0xDC00 <= endPrev && endPrev <= 0xDFFF) {
                console.warn('[warn] piece.end after low-surrogate', p);
            }
        }
    }
}
