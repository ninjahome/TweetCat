import {TweetContent} from "./tweet_entry";
import {clamp, collectUrlPiecesWithHiddenSet, escapeHTML, getHiddenMediaShortUrls, Piece, plain} from "./render_common";

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
export function updateTweetContentArea(container: HTMLElement, tweet: TweetContent,
                                       opts?: { hiddenShortUrls?: Iterable<string> }) {
    const tweetContent = container.querySelector(".tweet-content") as HTMLElement | null;
    if (!tweetContent) {
        console.log("------>>> tweet content not found:", container);
        return;
    }

    tweetContent.setAttribute('dir', 'auto');
    if (tweet.lang) tweetContent.setAttribute('lang', tweet.lang);

    tweetContent.innerHTML = buildVisibleWithEntitiesHTML(
        tweet,
        opts?.hiddenShortUrls ?? []   // ← 新增
    );
}

export function buildVisibleWithEntitiesHTML(tweet: TweetContent,
                                             extraHiddenShortUrls: Iterable<string> = []): string {
    const full = tweet.full_text ?? '';
    const [start, end] = getVisibleRange(tweet, full);

    // 新增：媒体短链隐藏集合
    const hiddenMedia = getHiddenMediaShortUrls(tweet);

    // ✅ 新增：合并“外部隐藏项”
    const hidden = new Set<string>(hiddenMedia);
    for (const u of extraHiddenShortUrls) hidden.add(u);

    const pieces: Piece[] = [];
    pieces.push(...collectMentionPieces(tweet, full, start, end));
    pieces.push(...collectHashtagPieces(tweet, full, start, end));
    pieces.push(...collectUrlPiecesWithHiddenSet(tweet, full, start, end, hidden));

    return assembleVisibleHtml(full, start, end, pieces);
}


