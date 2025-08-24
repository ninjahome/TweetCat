import {TweetContent} from "./tweet_entry";
import {formatCount} from "../common/utils";
import {logTCR} from "../common/debug_flags";

export function updateTweetBottomButtons(
    container: HTMLElement,
    tweetContent: TweetContent,
    screenName: string,
    viewsCount: number | undefined,
    mp4Dict: Record<string, string>
): void {
    logTCR("----------------------->>>>mp4 diction:", mp4Dict);
    const reply = container.querySelector('.replyNo .count');
    const retweet = container.querySelector('.retweetNo .count');
    const like = container.querySelector('.likeNo .count');
    const views = container.querySelector('.viewNo .count');
    const viewsLink = container.querySelector('.viewLink') as HTMLAnchorElement | null;

    reply && (reply.textContent = formatCount(tweetContent.reply_count).toLocaleString() ?? '');
    retweet && (retweet.textContent = formatCount(tweetContent.retweet_count + tweetContent.quote_count).toLocaleString() ?? '');
    like && (like.textContent = formatCount(tweetContent.favorite_count).toLocaleString() ?? '');
    views && (views.textContent = formatCount(viewsCount ?? 0).toLocaleString() ?? '');

    if (viewsLink) {
        viewsLink.href = `/${screenName}/status/${tweetContent.id_str}/analytics`;
    }

    const replyBtn = container.querySelector(".action-button.replyNo") as HTMLElement;
    wireReplyDownloadOnce(replyBtn, mp4Dict);
}

/** 1) 选取一个用于下载的 mp4 URL（先取第一个；想要最高码率只需改排序） */
function pickMp4Url(mp4Dict: Record<string, string>): { url: string; bitrate: string } | null {
    const entries = Object.entries(mp4Dict);
    if (!entries.length) return null;

    // ✅ 目前：取“第一个”
    // 如果你想取最高码率，改为：
    // entries.sort((a, b) => Number(b[0]) - Number(a[0]));
    const [bitrate, url] = entries[0];
    return {url, bitrate};
}

/** 2) 执行下载：优先 fetch → blob → objectURL（需要 CORS），失败则新开标签页播放（可右键另存） */
async function downloadMp4(url: string, filename: string): Promise<void> {
    try {
        const resp = await fetch(url, {mode: 'cors'});
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const blob = await resp.blob();
        const objectUrl = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = filename; // 若 CORS 允许，会直接保存
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
    } catch (err) {
        console.warn('[downloadMp4] CORS/网络限制，回退到新标签打开：', err);
        const a = document.createElement('a');
        a.href = url;
        a.target = '_blank';
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }
}

/** 3) 只绑定一次 reply 的点击事件（通过 data-flag 防重复），事件里调用下载逻辑 */
function wireReplyDownloadOnce(replyBtn: HTMLElement | null, mp4Dict: Record<string, string>): void {
    if (!replyBtn) return;
    // 用 data 属性记号，避免重复绑定
    if ((replyBtn as HTMLElement).dataset.dlWired === '1') return;

    replyBtn.addEventListener('click', async () => {
        const picked = pickMp4Url(mp4Dict);
        if (!picked) {
            logTCR('[wireReplyDownloadOnce] mp4Dict 为空，跳过下载');
            return;
        }
        const {url, bitrate} = picked;
        const filename = `tweet-video-${bitrate}.mp4`;
        logTCR('[wireReplyDownloadOnce] downloading', {bitrate, url});
        await downloadMp4(url, filename);
    });

    (replyBtn as HTMLElement).dataset.dlWired = '1';
}