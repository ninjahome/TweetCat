import {logTCR} from "../common/debug_flags";
import {TweetContent, TweetObj} from "./tweet_entry";
import {
    onVideoDownloadAbort,
    onVideoDownloadError,
    onVideoDownloadProgress,
    onVideoDownloadStart,
    onVideoDownloadSuccess
} from "../content/tweetcat_web3_area";
import {sendMsgToService} from "../common/utils";
import {MsgType} from "../common/consts";
import {bookmarkApi} from "./twitter_api";
import {indexToGrade, resolutionToNearestP} from "./render_common";
import { t } from "../common/i18n";
import {showToastMsg} from "../content/common";

export function updateTweetBottomButtons(
    container: HTMLElement, tweetObj: TweetObj, mp4List: string[], entryID: string): void {
    const downloadDiv = container.querySelector(".action-button.download") as HTMLElement;
    (downloadDiv.querySelector(".download-txt") as HTMLElement).innerText=t('download_video')

    const fileName = "TweetCat_" + tweetObj.author.screenName + "@" + tweetObj.rest_id;
    prepareDownloadBtn(downloadDiv, fileName, mp4List)

    const rewardBtn = container.querySelector(".action-button.reward") as HTMLElement | null;
    if (rewardBtn && rewardBtn.dataset.wired !== "1") {
        rewardBtn.addEventListener("click", rewardKol);
        rewardBtn.dataset.wired = "1";
    }

    const bookMarkBtn = container.querySelector(".action-button.bookMarked") as HTMLButtonElement;
    const content = tweetObj.tweetContent;
    setBookStratus(bookMarkBtn, content.bookmarked);

    if (bookMarkBtn && bookMarkBtn.dataset.wired !== "1") {
        logTCR("------>>>", content, tweetObj.rest_id);
        bookMarkBtn.addEventListener("click", async () => {
            try {
                bookMarkBtn.disabled = true;
                await bookMark(entryID, tweetObj.rest_id, content, bookMarkBtn);
                showToastMsg(t('bookmark_success'), 2);
            } catch (e) {
                console.log("[bookMark] failed:", e);
                const msg = String((e as any)?.message ?? e ?? "").toLowerCase();
                if (msg.includes("_missing: tweet") || msg.includes("has already favorited tweet")) {
                    showToastMsg(t('bookmark_success'), 2);
                } else {
                    showToastMsg(t('bookmark_failed', String(e)), 4);
                }
            } finally {
                bookMarkBtn.disabled = false;
            }
        });
        bookMarkBtn.dataset.wired = "1";
    }
}

function setBookStratus(bookMarkBtn: HTMLElement, booked: boolean) {
    const bookTxt = bookMarkBtn.querySelector(".bookmark-txt") as HTMLElement;
    const icon = bookMarkBtn.querySelector(".bookmark-icon") as HTMLElement
    if (booked) {
        bookTxt.innerText = t('bookmark_remove');
        icon.classList.add("active")
    } else {
        bookTxt.innerText = t('bookmark_add');
        icon.classList.remove("active")
    }
}

export function prepareDownloadBtn(downloadDiv: HTMLElement, fileName: string, mp4List: string[], hostDiv?: HTMLElement) {
    if (mp4List.length === 0) {
        downloadDiv.style.display = "none";
        return;
    }
    logTCR("mp4 list:", mp4List);
    downloadDiv.style.display = ""; // 确保可见

    const downloadBtn = downloadDiv.querySelector(".action-button-download-btn") as HTMLButtonElement;
    const selectEl = downloadDiv.querySelector(".download-selection") as HTMLSelectElement;
    const option = downloadDiv.querySelector(".download-option") as HTMLOptionElement;

    selectEl.addEventListener("click", (e) => {
        e.stopPropagation(); // 阻止冒泡到父节点
    });

    populateDownloadOptions(selectEl, option, mp4List);

    if (downloadBtn.dataset.dlWired === "1") return;

    downloadBtn.addEventListener("click", async (e) => {
        e.stopPropagation(); // 阻止冒泡到父节点
        await downloadVideo(downloadBtn, selectEl, fileName, hostDiv)
    });

    downloadBtn.dataset.dlWired = "1";
}

async function bookMark(eid: string, tid: string, content: TweetContent, statusEL: HTMLElement) {
    const statusToBe = !content.bookmarked;
    await sendMsgToService({entryID: eid, bookmarked: statusToBe}, MsgType.TweetBookmarkToggle);
    setBookStratus(statusEL, statusToBe);
    await bookmarkApi(tid, statusToBe);
    content.bookmarked = statusToBe;
    logTCR("------>>> after bookMark:", content);
}

function rewardKol(_e: Event) {
    logTCR("------>>> reward kol by usdt");
}

async function downloadVideo(btn: HTMLButtonElement, selectEl: HTMLSelectElement, fileName: string, hostDiv?: HTMLElement) {
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
        const data = await downloadInProcess(url, filename, hostDiv);
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
async function downloadInProcess(url: string, filename: string, hostDiv?: HTMLElement): Promise<BlobPart[]> {
    const ac = new AbortController();
    const signal = ac.signal;

    const resp = await fetch(url, {mode: "cors", signal});
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const total = Number(resp.headers.get("Content-Length")) || 0;
    const reader = resp.body?.getReader();
    if (!reader) throw new Error("ReadableStream not supported");

    onVideoDownloadStart(total, filename, ac, hostDiv);

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


