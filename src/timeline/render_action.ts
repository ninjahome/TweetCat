import {logTCR} from "../common/debug_flags";
import {TweetContent, TweetObj} from "./tweet_entry";
import {
    onVideoDownloadAbort,
    onVideoDownloadError,
    onVideoDownloadProgress,
    onVideoDownloadStart, onVideoDownloadSuccess
} from "../content/tweetcat_web3_area";
import {sendMsgToService} from "../common/utils";
import {MsgType} from "../common/consts";
import {bookmarkApi} from "./twitter_api";

export function updateTweetBottomButtons(
    container: HTMLElement,
    tweetObj: TweetObj,
    mp4List: string[],
    entryID: string
): void {
    const downloadDiv = container.querySelector(".action-button.download") as HTMLElement;
    prepareDownloadBtn(downloadDiv, tweetObj, mp4List)

    const rewardBtn = container.querySelector(".action-button.reward") as HTMLElement | null;
    if (rewardBtn && rewardBtn.dataset.wired !== "1") {
        rewardBtn.addEventListener("click", rewardKol);
        rewardBtn.dataset.wired = "1";
    }

    const bookMarkBtn = container.querySelector(".action-button.bookMarked") as HTMLElement | null;
    const content = tweetObj.tweetContent;
    const bookTxt = bookMarkBtn?.querySelector(".bookmark-txt") as HTMLElement;
    setBookStratus(bookTxt, content.bookmarked);

    if (bookMarkBtn && bookMarkBtn.dataset.wired !== "1") {
        logTCR("------>>>", content, tweetObj.rest_id);
        bookMarkBtn.addEventListener("click", async () => {
            await bookMark(entryID, tweetObj.rest_id, content, bookTxt);
        });
        bookMarkBtn.dataset.wired = "1";
    }
}

function setBookStratus(statusEL: HTMLElement, booked: boolean) {
    if (booked) {
        statusEL.innerText = "取消收藏";
    } else {
        statusEL.innerText = "收藏";
    }
}

function prepareDownloadBtn(downloadDiv: HTMLElement, tweetObj: TweetObj, mp4List: string[]) {
    if (mp4List.length === 0) {
        downloadDiv.style.display = "none";
        return;
    }
    logTCR("mp4 list:", mp4List);
    downloadDiv.style.display = ""; // 确保可见

    const downloadBtn = downloadDiv.querySelector(".downloadVideo") as HTMLButtonElement;
    const selectEl = downloadDiv.querySelector(".download-selection") as HTMLSelectElement;
    const option = downloadDiv.querySelector(".download-option") as HTMLOptionElement;

    populateDownloadOptions(selectEl, option, mp4List);

    const fileName = "TweetCat_" + tweetObj.author.screenName + "@" + tweetObj.rest_id;
    if (downloadBtn.dataset.dlWired === "1") return;

    downloadBtn.addEventListener("click", async () => {
        await downloadVideo(downloadBtn, selectEl, fileName)
    });

    downloadBtn.dataset.dlWired = "1";
}

async function bookMark(eid: string, tid: string, content: TweetContent, statusEL: HTMLElement) {
    try {
        const statusToBe = !content.bookmarked;
        await bookmarkApi(tid, statusToBe);
        await sendMsgToService({entryID: eid, bookmarked: statusToBe}, MsgType.TweetBookmarkToggle);
        content.bookmarked = statusToBe;
        setBookStratus(statusEL, statusToBe);
        logTCR("------>>> after bookMark:", content);
    } catch (e) {
        logTCR("[bookMark] failed:", e);
    }
}

function rewardKol(_e: Event) {
    logTCR("------>>> reward kol by usdt");
}

async function downloadVideo(btn: HTMLButtonElement, selectEl: HTMLSelectElement, fileName: string) {
    const url = selectEl.value;
    if (!url) {
        logTCR("[wireDownloadOnce] 未找到视频的URL");
        return;
    }

    const opt = (selectEl.options[selectEl.selectedIndex] as HTMLOptionElement) || null;
    const p = opt?.dataset.p ?? "";

    const filename = p ? `${fileName}_${p}_.mp4` : `${fileName}_.mp4`;

    logTCR("[wireDownloadOnce] downloading", {bitrate: p, url, filename});

    if (btn.dataset.downloading === "1") return;
    btn.dataset.downloading = "1";
    selectEl.disabled = true;

    try {
        const data = await downloadInProcess(url, filename);
        await saveMp4File(data, filename);
    } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
            onVideoDownloadAbort(filename);
            return;
        }
        onVideoDownloadError(filename, err as Error);
        showVideoTab(url);

        logTCR("[downloadMp4] stream failed, fallback to new tab:", err);
    } finally {
        selectEl.disabled = false;
        delete btn.dataset.downloading;
    }
}

function showVideoTab(url: string) {
    // 回退：新标签打开（无法拿到进度）
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}


/** ======================== 工具函数 ======================== **/
async function downloadInProcess(url: string, filename: string): Promise<BlobPart[]> {
    const ac = new AbortController();
    const signal = ac.signal;

    const resp = await fetch(url, {mode: "cors", signal});
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const total = Number(resp.headers.get("Content-Length")) || 0;
    const reader = resp.body?.getReader();
    if (!reader) throw new Error("ReadableStream not supported");

    onVideoDownloadStart(total, filename, ac);

    const parts: BlobPart[] = [];
    let loaded = 0;

    while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        if (value) {
            const ab = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
            parts.push(ab);
            loaded += value.byteLength;
            onVideoDownloadProgress(filename, loaded);
        }
    }

    return parts;
}

async function saveMp4File(parts: BlobPart[], filename: string): Promise<void> {
    if (parts.length === 0) return;

    const blob = new Blob(parts, {type: "video/mp4"});
    const objectUrl = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    URL.revokeObjectURL(objectUrl)
    onVideoDownloadSuccess(filename);
}

function resolutionToNearestP(url: string): string {
    const m = url.match(/\/(\d+)x(\d+)\//);
    if (!m) return `${360}p`;
    const w = Number(m[1]), h = Number(m[2]);
    if (!Number.isFinite(w) || !Number.isFinite(h)) return `${360}p`;

    const shortEdge = Math.min(w, h);
    const ladder = [144, 240, 360, 480, 540, 720, 1080, 1440, 2160];
    let best = ladder[0], bestDiff = Math.abs(shortEdge - best);
    for (let i = 1; i < ladder.length; i++) {
        const diff = Math.abs(shortEdge - ladder[i]);
        if (diff < bestDiff) {
            best = ladder[i];
            bestDiff = diff;
        }
    }
    return `${best}p`;
}


function populateDownloadOptions(selectEl: HTMLSelectElement, option: HTMLOptionElement, items: string[]): void {
    selectEl.innerHTML = '';
    const total = items.length;
    if (total === 0) return;

    items.forEach((url, idx) => {
        const opt = option.cloneNode(true) as HTMLOptionElement;
        opt.style.display = 'block';
        opt.value = url;

        const grade = indexToGrade(idx, total);
        const p = resolutionToNearestP(url);
        opt.textContent = `${grade} • ${p}`;
        opt.dataset.p = p;

        selectEl.appendChild(opt);
    });

    selectEl.value = String(items[total - 1]);
}


function indexToGrade(idx: number, total: number): string {
    if (total <= 1) return "品质";
    if (total === 2) return idx === 0 ? "品质低" : "品质高";
    if (idx === 0) return "品质低";
    if (idx === total - 1) return "品质高";
    return "品质中";
}
