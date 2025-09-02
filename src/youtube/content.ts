import browser from "webextension-polyfill";
import {MsgType} from "../common/consts";
import {isTcMessage, TcMessage} from "../common/msg_obj";
import {sendMsgToService} from "../common/utils";

function mountInjection() {
    const YT_INJECT_PATH = 'yt-inject-patch';
    if (document.getElementById(YT_INJECT_PATH)) return;

    const url = browser.runtime.getURL('js/yt_inject.js');
    const s = document.createElement('script');
    s.id = YT_INJECT_PATH;
    s.src = url;
    s.onload = () => s.remove();      // 注入后自删
    document.documentElement.appendChild(s);
}

mountInjection();

export type Stream = {
    itag: string;
    mimeType: string;
    url?: string;                 // 可能没有直链
    signatureCipher?: string;     // 新增：保存 cipher 原文
    cipher?: string;              // 新增：有些老字段名是 cipher
    width?: number;
    height?: number;
    fps?: number;
    bitrate?: number;
    audioQuality?: string;
    approxDurationMs?: string;
};


let lastDirectSet: Set<string> | null = null;

let lastList: Array<{
    itag: string; kind: "audio" | "video" | "progressive";
    container: string; codecs: string;
    width: number; height: number; fps: number; pixels: number;
    url: string;
}> = [];

export function refreshYoutubeUI(streams: Stream[]) {
    const isDirectPlayback = (u: string) =>
        /\/\/[^/]*googlevideo\.com\/videoplayback/.test(u);

    const pickUrl = (s: any): string | null => {
        if (s.url && isDirectPlayback(s.url)) return s.url;
        const sc = s.signatureCipher || s.cipher;
        if (sc && typeof sc === "string") {
            const p = new URLSearchParams(sc);
            const u = p.get("url") || "";
            const sig = p.get("sig") || p.get("signature");
            const sp = p.get("sp") || "signature";
            if (u && isDirectPlayback(u)) {
                if (sig) {
                    const sep = u.includes("?") ? "&" : "?";
                    return `${u}${sep}${sp}=${sig}`;
                }
                return null; // 只有加密 s 的先丢弃
            }
        }
        return null;
    };

    const parseMime = (mime?: string): { container: string; codecs: string } => {
        if (!mime) return {container: "", codecs: ""};
        const [type, ...rest] = mime.split(";");
        const container = type.trim();
        const codecs = rest.join(";").replace(/codecs=|"/g, "").trim();
        return {container, codecs};
    };
// rows：明确输入/输出类型，去掉 any
    type Row = {
        itag: string;
        kind: "audio" | "video" | "progressive";
        container: string;
        codecs: string;
        width: number;
        height: number;
        fps: number;
        pixels: number;
        url: string;
    };

    const rows: Row[] = streams.map((s: Stream) => {
        const url = pickUrl(s);
        if (!url) return null as unknown as Row; // 占位，后面会 filter(Boolean)
        const {container, codecs} = parseMime(s.mimeType);
        const codecsLower = (codecs || "").toLowerCase();
        const hasAudio = /\b(mp4a|opus)\b/.test(codecsLower);

        const kind: Row["kind"] =
            container.startsWith("audio/")
                ? "audio"
                : container.startsWith("video/") && hasAudio
                    ? "progressive"
                    : "video";

        const width = s.width ?? 0;
        const height = s.height ?? 0;
        const fps = s.fps ?? 0;

        return {
            itag: s.itag,
            kind,
            container,
            codecs,
            width,
            height,
            fps,
            pixels: width * height,
            url,
        };
    }).filter(Boolean) as Row[];

    // url 去重
    const byUrl = new Map<string, typeof rows[number]>();
    for (const r of rows) if (!byUrl.has(r.url)) byUrl.set(r.url, r);
    let list = Array.from(byUrl.values());

    // 稳定排序：progressive > video > audio；同类按像素数、fps 降序
    const kindWeight = (k: string) => k === "progressive" ? 0 : (k === "video" ? 1 : 2);
    list.sort((a, b) => {
        const kw = kindWeight(a.kind) - kindWeight(b.kind);
        if (kw !== 0) return kw;
        if (b.pixels !== a.pixels) return b.pixels - a.pixels;
        return b.fps - a.fps;
    });

    // 每个(kind, 分辨率)只留一个最佳（避免同清晰度多编码刷屏）
    const seenBucket = new Set<string>();
    list = list.filter(r => {
        const bucket = `${r.kind}|${r.width}x${r.height}`;
        if (!r.width || !r.height) return true; // 音频/无分辨率的不分桶
        if (seenBucket.has(bucket)) return false;
        seenBucket.add(bucket);
        return true;
    });

    // 集合一致性：与上次完全一致就不打印
    const currentSet = new Set(list.map(v => v.url));
    if (lastDirectSet &&
        currentSet.size === lastDirectSet.size &&
        Array.from(currentSet).every(u => lastDirectSet!.has(u))) {
        return;
    }
    lastDirectSet = currentSet;

    if (list.length === 0) {
        console.log("NONE");
        return;
    }
    console.log("------------->>>>> [direct playable streams]");
    const shortHost = (u: string = "") => {
        try {
            return new URL(u).host.split(".").slice(-3).join(".");
        } catch {
            return "";
        }
    };

// 这里统一打印 list（已经去重 + 分桶 + 排序）
    for (const r of list) {
        const res = r.width && r.height ? `${r.width}x${r.height}${r.fps ? `@${r.fps}` : ""}` : "";
        console.log(`${r.itag} | ${r.kind} | ${r.container} (${r.codecs}) | ${res} | https://${shortHost(r.url)}`);
    }

    // ★ 保存下来，给 save 用
    lastList = list;

    // ★ 给页面暴露一个全局 save(itag?)，默认下第一个 progressive
    (window as any).save = (itagOrIndex?: number | string) => {
        if (!lastList.length) {
            console.warn("[save] no list yet");
            return;
        }
        let pick = lastList.find(v => String(v.itag) === String(itagOrIndex));
        if (!pick && typeof itagOrIndex === "number") {
            pick = lastList[itagOrIndex]; // 允许用索引
        }
        if (!pick) {
            // 默认：挑第一个 progressive，没有就挑第一个视频，没有再挑第一个音频
            pick = lastList.find(v => v.kind === "progressive")
                ?? lastList.find(v => v.kind === "video")
                ?? lastList[0];
        }

        const ext =
            pick.container.includes("mp4") ? "mp4" :
                pick.container.includes("webm") ? "webm" :
                    pick.container.split("/")[1] || "bin";

        const res =
            pick.width && pick.height
                ? `${pick.width}x${pick.height}${pick.fps ? `@${pick.fps}` : ""}`
                : (pick.kind === "audio" ? "audio" : "video");

        const filename = `yt-${pick.itag}-${res}.${ext}`;
        console.log(`[save] downloading ${pick.itag} -> ${filename}`);
        saveViaBg(pick.url, filename);
    };
}


function saveViaBg(url: string, filename: string) {
    sendMsgToService({
        url: url,
        filename: filename
    }, MsgType.SaveVideo).catch(e => console.error("saveViaBg failed:", e));
}

document.addEventListener('DOMContentLoaded', onDocumentLoaded);

async function onDocumentLoaded() {
}

window.addEventListener("message", (ev) => {
    const msg = ev.data as TcMessage;
    if (!isTcMessage(msg)) {
        return;
    }

    switch (msg.action) {
        case MsgType.IJYoutubeVideoParam: {
            refreshYoutubeUI(msg.data as Stream[]);
            break;
        }
        default:
            return;
    }

});