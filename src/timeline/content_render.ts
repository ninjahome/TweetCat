import {TweetContent} from "./tweet_entry";
// ==== types & tiny utils ====
type Piece = { start: number; end: number; html: string };

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

// 可见区 [start,end)（暂按 code units，后续 Step 11 再统一索引体系）
function getVisibleRange(tweet: TweetContent, full: string): [number, number] {
    const r = tweet.display_text_range;
    if (Array.isArray(r) && r.length === 2) {
        const s = clamp(r[0] ?? 0, 0, full.length);
        const e = clamp(r[1] ?? full.length, s, full.length);
        return [s, e];
    }
    return [0, full.length];
}

// mentions
function collectMentionPieces(tweet: TweetContent, full: string, visibleS: number, visibleE: number): Piece[] {
    const arr = tweet.entities?.user_mentions ?? [];
    return arr.flatMap(u => {
        const s = clamp(u.indices?.[0] ?? 0, 0, full.length);
        const e = clamp(u.indices?.[1] ?? 0, 0, full.length);
        if (e <= visibleS || s >= visibleE) return [];
        return [{
            start: s, end: e,
            html: `<a href="/${u.screen_name}" class="mention">@${escapeHTML(u.screen_name)}</a>`
        }];
    });
}

// hashtags
function collectHashtagPieces(tweet: TweetContent, full: string, visibleS: number, visibleE: number): Piece[] {
    const arr = tweet.entities?.hashtags ?? [];
    return arr.flatMap(h => {
        const s = clamp(h.indices?.[0] ?? 0, 0, full.length);
        const e = clamp(h.indices?.[1] ?? 0, 0, full.length);
        if (e <= visibleS || s >= visibleE) return [];
        const t = h.text ?? '';
        return [{
            start: s, end: e,
            html: `<a href="/hashtag/${escapeHTML(t)}" class="hashtag">#${escapeHTML(t)}</a>`
        }];
    });
}

// urls（Step 2 不做隐藏判断）
function collectUrlPieces(tweet: TweetContent, full: string, visibleS: number, visibleE: number): Piece[] {
    const arr = tweet.entities?.urls ?? [];
    return arr.flatMap(u => {
        const s = clamp(u.indices?.[0] ?? 0, 0, full.length);
        const e = clamp(u.indices?.[1] ?? 0, 0, full.length);
        if (e <= visibleS || s >= visibleE) return [];
        const href = u.expanded_url ?? u.url;
        const label = u.display_url ?? href;
        return [{
            start: s, end: e,
            html: `<a class="url" href="${escapeHTML(href)}" target="_blank" rel="noopener noreferrer">${escapeHTML(label)}</a>`
        }];
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

// ===== integrate =====
export function updateTweetContentArea(container: HTMLElement, tweet: TweetContent) {
    const tweetContent = container.querySelector(".tweet-content") as HTMLElement | null;
    if (!tweetContent) {
        console.log("------>>> tweet content not found:", container);
        return;
    }
    tweetContent.innerHTML = buildVisibleWithEntitiesHTML(tweet);
}


/* ---------- helpers ---------- */
function plain(txt: string): string {
    return escapeHTML(txt).replace(/\n/g, '<br>');
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

function getHiddenMediaShortUrls(tweet: TweetContent): Set<string> {
    const set = new Set<string>();
    const mediaArr = tweet.extended_entities?.media ?? [];
    for (const m of mediaArr) {
        if (m?.url) set.add(m.url);
    }
    return set;
}

function collectUrlPiecesWithHiddenSet(
    tweet: TweetContent,
    full: string,
    visibleS: number,
    visibleE: number,
    hiddenShortUrls: Set<string>
): Piece[] {
    const arr = tweet.entities?.urls ?? [];
    return arr.flatMap(u => {
        const s = clamp(u.indices?.[0] ?? 0, 0, full.length);
        const e = clamp(u.indices?.[1] ?? 0, 0, full.length);
        if (e <= visibleS || s >= visibleE) return [];

        // 命中“需要隐藏”的短链：用空片段覆盖该区间（不输出）
        if (u?.url && hiddenShortUrls.has(u.url)) {
            return [{ start: s, end: e, html: '' }];
        }

        // 正常可点击链接（仍然是 Step 2 的简单策略）
        const href = u.expanded_url ?? u.url;
        const label = u.display_url ?? href;
        return [{
            start: s, end: e,
            html: `<a class="url" href="${escapeHTML(href)}" target="_blank" rel="noopener noreferrer">${escapeHTML(label)}</a>`
        }];
    });
}


export function buildVisibleWithEntitiesHTML(tweet: TweetContent): string {
    const full = tweet.full_text ?? '';
    const [start, end] = getVisibleRange(tweet, full);

    // 新增：媒体短链隐藏集合
    const hiddenMedia = getHiddenMediaShortUrls(tweet);

    const pieces: Piece[] = [];
    pieces.push(...collectMentionPieces(tweet, full, start, end));
    pieces.push(...collectHashtagPieces(tweet, full, start, end));
    // 改为带隐藏集合的 URL 收集器
    pieces.push(...collectUrlPiecesWithHiddenSet(tweet, full, start, end, hiddenMedia));

    return assembleVisibleHtml(full, start, end, pieces);
}
