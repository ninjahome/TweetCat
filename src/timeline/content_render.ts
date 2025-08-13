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

    tweetContent.setAttribute('dir', 'auto');
    if (tweet.lang) tweetContent.setAttribute('lang', tweet.lang);

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

    // 小工具：判断“空白”（空格/制表/换行）
    const isWS = (ch: string) => ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r' || ch === '\f';

    return arr.flatMap(u => {
        let s = clamp(u.indices?.[0] ?? 0, 0, full.length);
        let e = clamp(u.indices?.[1] ?? 0, 0, full.length);
        if (e <= visibleS || s >= visibleE) return [];

        // ✅ 如果是“需要隐藏”的短链（媒体占位），连同两侧空白一起吞掉
        if (u?.url && hiddenShortUrls.has(u.url)) {
            // 向左吃掉前导空白
            while (s > visibleS && isWS(full[s - 1])) s--;
            // 向右吃掉后缀空白
            while (e < visibleE && isWS(full[e])) e++;
            return [{ start: s, end: e, html: '' }];
        }

        // ✅ 正常链接：href 用 t.co，label 用 display_url，title 用 expanded_url
        const href  = u.url ?? u.expanded_url ?? '';
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


