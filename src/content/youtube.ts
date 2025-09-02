// content_youtube.ts  —— 供 content 环境使用，只打印不下载

// 与注入侧保持一致的结构
export type Stream = {
    itag: string;
    mimeType: string;
    url: string;
    width?: number;
    height?: number;
    fps?: number;
    bitrate?: number;
    audioQuality?: string;
    approxDurationMs?: string;
};

// === 工具函数 ==============================================================
type Kind = "video" | "audio" | "other";
const PROGRESSIVE_ITAGS = new Set(["18", "22"]); // 常见一体流（含音频）

function normUrl(raw: string): string {
    // 去掉只影响分片/顺序的参数，避免只下到一小段
    try {
        const u = new URL(raw);
        ["range", "rn", "rbuf"].forEach(p => u.searchParams.delete(p));
        return u.toString();
    } catch {
        return raw;
    }
}

function hasN(raw: string): boolean {
    try {
        return !!new URL(raw).searchParams.get("n");
    } catch {
        return false;
    }
}

function kindOf(mime: string): Kind {
    if (mime.startsWith("video/")) return "video";
    if (mime.startsWith("audio/")) return "audio";
    return "other";
}

function humanLabel(s: Stream): string {
    const [kindRaw] = s.mimeType.split(";");
    const k = kindOf(s.mimeType);
    if (k === "video") {
        const res = s.height ? `${s.height}p` : (s.width ? `${s.width}w` : "video");
        const fps = s.fps ? `@${s.fps}` : "";
        return `视频 ${res}${fps}`;
    }
    if (k === "audio") {
        const kbps = s.bitrate ? Math.round(s.bitrate / 1000) + "kbps" : "";
        return `音频 ${kbps}`.trim();
    }
    return kindRaw;
}

function suggestPairs(list: Array<Stream & {_kind: Kind}>): {
    progressive?: Stream & {_kind: Kind};
    bestVideo?: Stream & {_kind: Kind};
    bestAudio?: Stream & {_kind: Kind};
} {
    const progressive = list.find(s => PROGRESSIVE_ITAGS.has(s.itag));
    const bestVideo = list.find(s => s._kind === "video" && !PROGRESSIVE_ITAGS.has(s.itag));
    const bestAudio = list.find(s => s._kind === "audio");
    return { progressive, bestVideo, bestAudio };
}

// === 入口函数：收到注入消息后只打印 =========================================
export function refreshYoutubeUI(streams: Stream[]) {
    try {
        // 1) 规范化 + 标注
        const mapped = streams.map(s => {
            const url = normUrl(s.url);
            return Object.assign({}, s, {
                url,
                _kind: kindOf(s.mimeType) as Kind,
                _hasN: hasN(url),
                _label: humanLabel(s),
            });
        });

        // 2) 去重（按 URL）
        const dedup = mapped.filter((x, i, arr) => arr.findIndex(y => y.url === x.url) === i);

        // 3) 排序：一体流 → 其他视频 → 音频
        const ordered = [
            ...dedup.filter(s => PROGRESSIVE_ITAGS.has(s.itag)),
            ...dedup.filter(s => s._kind === "video" && !PROGRESSIVE_ITAGS.has(s.itag)),
            ...dedup.filter(s => s._kind === "audio"),
        ];

        if (!ordered.length) {
            console.warn("[YT] 没有可打印的直链（可能都需要 signature decipher 或 n 变换）");
            return;
        }

        // 4) 控制台输出（表格 + 完整 URL）
        console.groupCollapsed(`[YT] 收到 ${ordered.length} 条候选直链（仅打印，不下载）`);
        console.table(
            ordered.map(s => ({
                itag: s.itag,
                类型: s._kind,
                说明: s._label,
                分辨率: s.height ? `${s.height}p` : "",
                fps: s.fps || "",
                mime: s.mimeType.split(";")[0],
                含n参数: s._hasN,
                约时长ms: s.approxDurationMs || "",
            }))
        );
        console.log("[YT] 规范化后的直链（逐条复制可测）：");
        ordered.forEach((s, i) => {
            const note = [
                s._kind.toUpperCase(),
                s._label,
                `itag=${s.itag}`,
                s._hasN ? "n=存在(可能需变换)" : "n=无",
            ].join(" | ");
            console.log(`${i + 1}. ${note}\n    ${s.url}`);
        });
        console.groupEnd();

        // 5) 给出人工优先测试的推荐
        const rec = suggestPairs(ordered as any);
        console.log("[YT] 推荐测试：");
        if (rec.progressive) {
            console.log(`- 一体流优先（含音频）：itag=${rec.progressive.itag} → ${rec.progressive.url}`);
        } else if (rec.bestVideo && rec.bestAudio) {
            console.log(`- 分离流：视频 itag=${rec.bestVideo.itag} → ${rec.bestVideo.url}`);
            console.log(`         音频 itag=${rec.bestAudio.itag} → ${rec.bestAudio.url}`);
            console.log("  （分离流下载后需本地合并）");
        } else {
            console.log("- 未找到合适组合，请把上面的表格与链接贴给我分析。");
        }
    } catch (e) {
        console.warn("[YT] refreshYoutubeUI 打印失败：", e);
    }
}
