// render_content.ts
import {TweetContent, TweetEntity} from "./tweet_entry";
import {logRCT} from "../common/debug_flags";

type Piece = { start: number; end: number; html: string };

/* =========================
 *  1) CP→CU 映射（仅入口用）
 * ========================= */
export function buildCpToCuMap(str: string): number[] {
    const map: number[] = [];
    let cu = 0;
    for (const ch of Array.from(str)) {
        map.push(cu);          // 本 code point 开始的 CU 偏移
        cu += ch.length;       // BMP=1，代理对=2
    }
    map.push(cu);            // 末尾（便于作右边界）
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

/* =========================
 *  2) 入口：更新正文
 * ========================= */
export function updateTweetContentArea(
    container: HTMLElement,
    tweet: TweetContent,
    opts?: { hiddenShortUrls?: Iterable<string>, isQuoted?: boolean, hasMore?: boolean }
) {
    const isShowMore = opts?.hasMore ?? false;
    const isQuoted = opts?.isQuoted ?? false;

    const tweetContent = container.querySelector(".tweet-content") as HTMLElement;
    tweetContent.setAttribute("dir", "auto");
    if (tweet.lang) tweetContent.setAttribute("lang", tweet.lang);
    tweetContent.innerHTML = buildVisibleWithEntitiesHTML(
        tweet,
        opts?.hiddenShortUrls ?? [],
        isQuoted
    );

    if (isShowMore && !isQuoted) {
        const moreAnchor = container.querySelector(".tc-main-more") as HTMLElement;
        // logRCT("this tweets should show more:\n", tweet.note_full_text);
        moreAnchor.hidden = false;
        moreAnchor.removeAttribute("hidden");
        moreAnchor.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            tweetContent.innerHTML = buildVisibleWithEntitiesHTML(
                tweet,
                opts?.hiddenShortUrls ?? [],
                isQuoted,
                true   // ★ 强制使用完整文本
            );
            moreAnchor.hidden = true;
        }, {once: true});
    }
}

/* =========================
 *  3) 构建可见 HTML
 * ========================= */
export function buildVisibleWithEntitiesHTML(
    tweet: TweetContent,
    extraHiddenShortUrls: Iterable<string> = [],
    isQuoted: boolean = false,
    useFullText: boolean = false
): string {
    const full = (useFullText && tweet.note_full_text) ? tweet.note_full_text : (tweet.full_text ?? "");
    const cpToCu = buildCpToCuMap(full);

    // 如果是 Note 长文并且 useFullText，就换用 note_entities
    const entities = (useFullText && tweet.note_entities) ? tweet.note_entities : tweet.entities;

    // ★ 注意：当 useFullText=true 时，我们不用 display_text_range，而是全量
    const [start, end] = useFullText
        ? [0, full.length]
        : getVisibleRange(tweet, full, cpToCu);

    const hidden = new Set<string>(getHiddenMediaShortUrls(tweet, entities));
    for (const u of extraHiddenShortUrls) hidden.add(u);

    const pieces: Piece[] = [];
    if (!isQuoted) {
        pieces.push(...collectMentionPieces(entities, start, end, cpToCu));
        pieces.push(...collectHashtagPieces(entities, start, end, cpToCu));
        pieces.push(...collectUrlPiecesWithHiddenSet(entities, full, start, end, hidden, cpToCu));
    }
    pieces.push(...collectHiddenShortUrlPiecesBySearch(full, start, end, hidden));

    return assembleVisibleHtml(full, start, end, pieces);
}

``
/* =========================
 *  4) 基线逻辑（只把索引换成 CP→CU）
 * ========================= */

// 可见区 [start,end) —— 把 display_text_range 的 code point 索引映射到 code unit
function getVisibleRange(tweet: TweetContent, full: string, cpToCu: number[]): [number, number] {
    const r = tweet.display_text_range;
    if (Array.isArray(r) && r.length === 2) {
        return cpRangeToCuClamped(r[0], r[1], cpToCu);
    }
    return [0, full.length];
}

function collectMentionPieces(
    entities: TweetEntity, visibleS: number, visibleE: number, cpToCu: number[]
): Piece[] {
    const arr = entities?.user_mentions ?? [];
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
    entities: TweetEntity, visibleS: number, visibleE: number, cpToCu: number[]
): Piece[] {
    const arr = entities?.hashtags ?? [];
    return arr.flatMap(h => {
        const [s, e] = cpRangeToCuClamped(h.indices?.[0], h.indices?.[1], cpToCu);
        if (e <= visibleS || s >= visibleE) return [];
        const t = h.text ?? '';
        return [{
            start: s, end: e,
            html: `<a href="/hashtag/${escapeHTML(t)}" class="hashtag">#${escapeHTML(t)}</a>`
        }];
    });
}

function collectUrlPiecesWithHiddenSet(
    entities: TweetEntity,
    full: string,
    visibleS: number,
    visibleE: number,
    hiddenShortUrls: Set<string>,
    cpToCu: number[]
): Piece[] {
    const arr = entities?.urls ?? [];
    const isWS = (ch: string) =>
        ch === " " || ch === "\n" || ch === "\t" || ch === "\r" || ch === "\f";

    return arr.flatMap(u => {
        if (!u.indices || u.indices.length !== 2) return [];

        // 把 code point 索引映射到 code unit
        const [s0, e0] = cpRangeToCuClamped(u.indices[0], u.indices[1], cpToCu);
        let s = s0, e = e0;

        if (e <= visibleS || s >= visibleE) return [];

        // 命中“需要隐藏”的短链（媒体/卡片），用空片段“占位”以真正吞掉该区间
        if (u.url && hiddenShortUrls.has(u.url)) {
            while (s > visibleS && isWS(full[s - 1])) s--; // 吞前导空白
            while (e < visibleE && isWS(full[e])) e++;     // 吞尾随空白
            return [{start: s, end: e, html: ''}];
        }

        // 正常链接：label 用 display_url，href 用 expanded_url（无协议则退回 '#')
        const display = escapeHTML(u.display_url ?? u.url ?? '');
        const rawHref = u.expanded_url ?? u.url ?? '';
        const href = /^https?:\/\//i.test(rawHref) ? rawHref : '#';

        const html =
            `<a href="${escapeHTML(href)}" class="tweet-url" ` +
            `rel="nofollow noreferrer noopener" target="_blank">` +
            `${display}</a>`;

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

/* =========================
 *  5) 辅助
 * ========================= */
function getHiddenMediaShortUrls(tweet: TweetContent, entities: TweetEntity): Set<string> {
    const set = new Set<string>();

    // extended_entities 优先（包含视频/GIF 等）
    const mediaArr =
        (tweet.extended_entities?.media && tweet.extended_entities.media.length
            ? tweet.extended_entities.media
            : (entities?.media || []));

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

function plain(txt: string): string {
    return escapeHTML(txt).replace(/\n/g, '<br>');
}


// 兜底：在全文里按字符串搜索隐藏集合里的短链，生成空片段把它吞掉
function collectHiddenShortUrlPiecesBySearch(
    full: string,
    visibleS: number,
    visibleE: number,
    hiddenShortUrls: Set<string>
): Piece[] {
    const isWS = (ch: string) => ch === " " || ch === "\n" || ch === "\t" || ch === "\r" || ch === "\f";
    const pieces: Piece[] = [];

    for (const short of hiddenShortUrls) {
        if (!short) continue;
        let pos = full.indexOf(short);
        while (pos !== -1) {
            let s = pos, e = pos + short.length;

            // 仅处理与可见区有交集的
            if (!(e <= visibleS || s >= visibleE)) {
                // 吞掉两端空白/换行，让视觉上不遗留多余空格
                while (s > visibleS && isWS(full[s - 1])) s--;
                while (e < visibleE && isWS(full[e])) e++;
                pieces.push({start: s, end: e, html: ""});
            }

            pos = full.indexOf(short, pos + short.length);
        }
    }
    return pieces;
}
