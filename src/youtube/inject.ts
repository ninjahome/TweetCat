import {TcMessage} from "../common/msg_obj";
import {MsgType} from "../common/consts";

function postToContent(action: string, data?: unknown): void {
    const msg = new TcMessage(action, true, data);
    window.postMessage(msg, '*'); // structured clone，安全传对象
}

declare global {
    interface Window {
        ytHasPatchedFetch?: boolean;
        ytPatchedFetch?: any;
        ytHasPatchedXHR?: boolean;
        ytPatchedXHR?: any;
        ytExtraHooksInstalled?: boolean;
    }
}

function ytStartHookWatchdog(): void {
    const RECHECK_MS = 500;
    setInterval(() => {
        try {
            if ((window as any).fetch !== window.ytPatchedFetch) {
                console.warn("fetch hook lost, re-hooking...");
                window.ytHasPatchedFetch = false;
                ytInstallFetch();
            }
            if (window.XMLHttpRequest !== window.ytPatchedXHR) {
                console.warn("xhr hook lost, re-hooking...");
                window.ytHasPatchedXHR = false;
                ytInstallXHR();
            }
        } catch (e) {
            console.warn("watchdog error", e);
        }
    }, RECHECK_MS);
}


const isPlayerApi = (url: string) =>
    /youtubei\/v\d+\/player/.test(url) || url.includes("get_video_info");

const isAdBreak = (url: string) => /\/player\/ad_break\b/.test(url);

function ytInstallFetch() {
    if (window.ytHasPatchedFetch) {
        console.log("📺[youtube]✅fetch hook already installed");
        return;
    }

    const originalFetch = window.fetch;

    const patchedFetch = async function (
        this: any,
        input: RequestInfo | URL,
        init?: RequestInit
    ): Promise<Response> {
        const url = input instanceof Request ? input.url : (typeof input === "string" ? input : String((input as URL).toString?.() ?? input));
        try {
            // console.debug("[yt] fetch url:", url);
            const res = await (originalFetch as any).call(this, input, init);

            if (!isAdBreak(url) && isPlayerApi(url)) {
                // console.log("------------->>>>> [before] player fetch", url, res.status);
                const cloned = res.clone();
                const text = await cloned.text();
                const json = text.trim().startsWith("{") ? JSON.parse(text) :
                    Object.fromEntries(new URLSearchParams(text));
                const data = json.playerResponse ?? json;
                parseData(data);
            }

            return res;

        } catch (e) {
            console.log(` original fetch failed`, e, url);
            throw e;
        }
    };

    (window as any).fetch = patchedFetch as typeof window.fetch;
    window.ytHasPatchedFetch = true;
    window.ytPatchedFetch = patchedFetch;
    console.log("📺[youtube]✅ fetch hook installed");
}

function parseData(data: any) {
    const formats = data?.streamingData?.formats ?? [];
    const adaptive = data?.streamingData?.adaptiveFormats ?? [];
    const isMeaningful = (f: any) => {
        const w = f.width ?? 0, h = f.height ?? 0;
        // 过滤 < 180p 的视频（常见是 144p 以下的预览/小流）
        if (h && h < 180) return false;
        // 过滤没有 URL 的或奇怪的占位
        if (!f.url && !f.signatureCipher) return false;
        return true;
    };

    const all = [...formats, ...adaptive].filter(isMeaningful);
    if (!all.length) return; // ★ 无格式就静音

    const toStream = (x: any) => ({
        itag: String(x.itag),
        mimeType: x.mimeType,
        url: x.url || undefined,                     // 只放直链
        signatureCipher: x.signatureCipher || x.cipher || undefined, // 这里放加密串
        width: x.width, height: x.height, fps: x.fps, bitrate: x.bitrate,
        audioQuality: x.audioQuality, approxDurationMs: x.approxDurationMs
    });

    const streams = all.map(toStream);
    postToContent(MsgType.IJYoutubeVideoParam, streams);
}


function ytInstallXHR() {
    if (window.ytHasPatchedXHR) {
        console.log("📺[youtube]✅xhr hook already installed");
        return;
    }

    const OriginalXHR = window.XMLHttpRequest;

    class patchedXHR extends OriginalXHR {
        private ytUrl: string | null = null;

        open(method: string, url: string, async?: boolean, user?: string | null, password?: string | null) {
            this.ytUrl = url;
            // console.debug("[yt][xhr] open url:", url);
            return super.open(method, url, async ?? true, user ?? null, password ?? null);
        }

        send(...args: any[]): void {
            if (this.ytUrl && !isAdBreak(this.ytUrl) && isPlayerApi(this.ytUrl)) {
                this.addEventListener("load", () => {
                    if (typeof this.responseText === "string" && this.responseText.length > 0) {
                        console.log("------------->>>>> [before] player xhr", this.ytUrl);
                        const text = this.responseText || "";
                        const json = text.trim().startsWith("{")
                            ? JSON.parse(text)
                            : Object.fromEntries(new URLSearchParams(text));
                        const data = (json as any).playerResponse ?? json;
                        parseData(data);
                    }
                });
            }
            return (OriginalXHR.prototype.send as any).apply(this, args);
        }
    }

    // @ts-ignore
    window.XMLHttpRequest = patchedXHR;
    window.ytHasPatchedXHR = true;
    window.ytPatchedXHR = patchedXHR;
    console.log("📺[youtube]✅ xhr hook installed");
}

function initYtInjection(): void {
    if (window.ytExtraHooksInstalled) {
        console.log("hooks already installed");
        return;
    }

    console.log("installing hooks...");
    ytInstallFetch();
    ytInstallXHR();
    ytStartHookWatchdog();
    window.ytExtraHooksInstalled = true;
    console.log("📺[youtube]✅ hooks ready");
}

initYtInjection();
