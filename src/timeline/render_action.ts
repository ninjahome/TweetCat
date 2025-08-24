import {logTCR} from "../common/debug_flags";

export function updateTweetBottomButtons(
    container: HTMLElement,
    mp4Dict: Record<string, string>
): void {
    logTCR("----------------------->>>>mp4 diction:", mp4Dict);

    const downloadDiv = container.querySelector(".action-button.download") as HTMLElement | null;
    if (!downloadDiv) return;

    const entries = Object.entries(mp4Dict);
    if (entries.length === 0) {
        downloadDiv.style.display = "none";
    } else {
        downloadDiv.style.display = ""; // 确保可见

        const downloadBtn = downloadDiv.querySelector(".downloadVideo") as HTMLButtonElement | null;
        const selectEl = downloadDiv.querySelector(".download-option") as HTMLSelectElement | null;

        // ✅ 根据 mp4Dict 动态生成下载清晰度选项
        if (selectEl) {
            populateDownloadOptions(selectEl, mp4Dict);
        }

        // ✅ 只绑定一次点击事件：按当前下拉框选择的码率下载
        wireDownloadOnce(downloadBtn, selectEl, mp4Dict);
    }

    // 其它按钮逻辑
    const rewardBtn = container.querySelector(".action-button.reward") as HTMLElement | null;
    if (rewardBtn && rewardBtn.dataset.wired !== "1") {
        rewardBtn.addEventListener("click", rewardKol);
        rewardBtn.dataset.wired = "1";
    }
}

/** ======================== 工具函数 ======================== **/


/** 只绑定一次下载按钮点击：按下拉框当前选中的码率下载 */
function wireDownloadOnce(
    btn: HTMLButtonElement | null,
    selectEl: HTMLSelectElement | null,
    mp4Dict: Record<string, string>
): void {
    if (!btn) return;
    if (btn.dataset.dlWired === "1") return;

    btn.addEventListener("click", async () => {
        // 取当前选择的码率；若为空则取最高码率
        let brKey = (selectEl?.value ?? "").trim();
        if (!brKey || !mp4Dict[brKey]) {
            const highest = Object.keys(mp4Dict)
                .map(Number)
                .filter(n => Number.isFinite(n))
                .sort((a, b) => b - a)[0];
            brKey = String(highest);
        }

        const url = mp4Dict[brKey];
        if (!url) {
            logTCR("[wireDownloadOnce] 未找到对应码率的 URL", brKey);
            return;
        }

        const res = parseResolutionFromUrl(url);
        const p = res ? resolutionToNearestP(res.w, res.h) : null;
        const filename =
            res && p
                ? `tweet-video-${p}-${res.w}x${res.h}-${brKey}.mp4`
                : `tweet-video-${brKey}.mp4`;

        logTCR("[wireDownloadOnce] downloading", {bitrate: brKey, url, filename});
        await downloadMp4(url, filename);
    });

    btn.dataset.dlWired = "1";
}

/** 执行下载：优先 fetch → blob（需要 CORS），失败回退“新标签打开” */
async function downloadMp4(url: string, filename: string): Promise<void> {
    try {
        const resp = await fetch(url, {mode: "cors"});
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const blob = await resp.blob();
        const objectUrl = URL.createObjectURL(blob);

        const a = document.createElement("a");
        a.href = objectUrl;
        a.download = filename; // CORS 允许时会直接保存
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
    } catch (err) {
        console.warn("[downloadMp4] CORS/网络限制，回退到新标签打开：", err);
        const a = document.createElement("a");
        a.href = url;
        a.target = "_blank";
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }
}

function rewardKol(_e: Event) {
    // TODO:: reward kol by token
    console.log("------>>> reward kol by usdt");
}

/** /.../720x1280/ -> {w:720,h:1280} */
function parseResolutionFromUrl(url: string): { w: number; h: number } | null {
    const m = url.match(/\/(\d+)x(\d+)\//);
    if (!m) return null;
    const w = Number(m[1]), h = Number(m[2]);
    if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
    return {w, h};
}

/** 将分辨率近似为常见 p 值（取短边） */
function resolutionToNearestP(w: number, h: number): string {
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


function populateDownloadOptions(selectEl: HTMLSelectElement, mp4Dict: Record<string, string>): void {
    // 清空旧选项
    while (selectEl.firstChild) selectEl.removeChild(selectEl.firstChild);

    // 按码率升序：低→高
    const items = Object.entries(mp4Dict)
        .map(([brStr, url]) => ({br: Number(brStr), brStr, url}))
        .filter(x => Number.isFinite(x.br))
        .sort((a, b) => a.br - b.br);

    const total = items.length;

    items.forEach((item, idx) => {
        const opt = document.createElement("option");
        opt.value = item.brStr; // 用码率作 value

        const grade = indexToGrade(idx, total);  // “品质低/中/高”
        const p = getPLabel(item.url, item.br);  // “480p/720p/...”
        opt.textContent = `${grade} • ${p}`;

        selectEl.appendChild(opt);
    });

    // 默认选中最高档
    if (total > 0) {
        selectEl.value = String(items[total - 1].br);
    }
}


function indexToGrade(idx: number, total: number): string {
    if (total <= 1) return "品质";
    if (total === 2) return idx === 0 ? "品质低" : "品质高";
    // total >= 3
    if (idx === 0) return "品质低";
    if (idx === total - 1) return "品质高";
    return "品质中";
}

function getPLabel(url: string, bps: number): string {
    // 优先从 URL 解析分辨率，如 /720x1280/
    const m = url.match(/\/(\d+)x(\d+)\//);
    if (m) {
        const w = Number(m[1]), h = Number(m[2]);
        return resolutionToNearestP(w, h)
    }
    // 解析不到时，按码率粗略映射
    if (bps < 800_000) return "360p";
    if (bps < 1_300_000) return "480p";
    if (bps < 2_500_000) return "720p";
    if (bps < 5_000_000) return "1080p";
    if (bps < 9_000_000) return "1440p";
    return "2160p";
}
