// ====== 1) 配置：你的 Native Messaging Host 名称 ======
import browser from "webextension-polyfill";

const NATIVE_HOST = 'com.dessage.ytdlp_bridge'; // ← 和原生侧注册的名字一致

// ====== 2) 对原生壳子的消息协议（你可以按需扩展） ======
type NativeAction = 'probe' | 'download';

interface NativeRequest {
    action: NativeAction;
    videoId: string;            // 例如 "G3n9pe8V3Ns"
    url?: string;               // 可选：完整 URL，如 https://www.youtube.com/watch?v=xxxx
    cookies?: Array<{           // 可选：content 传来的 cookie 列表，直接转发
        name: string;
        value: string;
        domain?: string;
        path?: string;
        secure?: boolean;
        httpOnly?: boolean;
        expires?: number;
    }>;
    formatQuery?: string;       // 可选：yt-dlp 的格式选择表达式
    outTemplate?: string;       // 可选：输出模板
}

interface NativeResponse {
    ok: boolean;
    message?: string;
    data?: any;
    cookie_file?: string;
    formats?: {
        ok: boolean;
        items: Array<{
            label: string;
            value: string;
            height?: number;
            kind?: "merge" | "single";
        }>;
    };
}

// ====== 3) 发送工具：发消息到原生壳子（带超时&错误处理） ======
async function sendToNative(payload: NativeRequest, timeoutMs = 15000): Promise<NativeResponse> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);

    try {
        const resp = await browser.runtime.sendNativeMessage(NATIVE_HOST, payload) as NativeResponse;
        return resp ?? {ok: false, message: 'empty native response'};
    } catch (err: any) {
        // 当原生 host 未注册/未安装时，这里会抛错
        return {ok: false, message: String(err?.message || err)};
    } finally {
        clearTimeout(t);
    }
}

// ====== 4) 你已有的方法：这里直接调用原生壳子，先做“探测” ======
export async function saveSimpleVideo(videoID: string) {
    console.log("---------->>> video id to download", videoID);

    const cookies = await readYouTubeCookies();
    // const summary = cookies.map((c) => `${c.name}@${c.domain}${c.path}`);
    // console.log(`[cookies] summary (${summary.length}):`, summary);

    const url = `https://www.youtube.com/watch?v=${videoID}`;
    const req: NativeRequest = {
        action: 'probe',
        videoId: videoID,
        url,
        cookies,
    };

    const res = await sendToNative(req);
    if (!res.ok) {
        console.warn('[native][probe] failed:', res.message);
        return;
    }

    const items = res.formats?.ok ? res.formats.items : [];
    console.log('[native][probe] ok, cookie_file:', res.cookie_file, items);
}


// 建议覆盖到常见 YouTube/Google 登录域
const COOKIE_URLS = [
    "https://www.youtube.com/",
    "https://m.youtube.com/",
    "https://studio.youtube.com/",
    "https://accounts.google.com/",
    "https://www.google.com/",
];

/**
 * 读取并打印各 URL 可用的 cookies，最终去重后返回
 */
async function readYouTubeCookies(): Promise<browser.Cookies.Cookie[]> {
    const collected: browser.Cookies.Cookie[] = [];

    for (const url of COOKIE_URLS) {
        try {
            const list = await browser.cookies.getAll({url});
            console.log(`[cookies] ${url} -> count=${list.length}`);

            // // 详细打印（含敏感值，谨慎！）
            // for (const c of list) {
            //     const preview =
            //         typeof c.value === "string" ? c.value.slice(0, 60) : String(c.value);
            //     console.log(
            //         `[cookie] domain=${c.domain} path=${c.path} name=${c.name} ` +
            //         `httpOnly=${c.httpOnly} secure=${c.secure} sameSite=${c.sameSite} ` +
            //         `expiry=${c.expirationDate ?? "(session)"} value="${preview}${
            //             c.value.length > 60 ? "..." : ""
            //         }"`
            //     );
            // }

            collected.push(...list);
        } catch (e) {
            console.warn(`[cookies] failed for ${url}:`, e);
        }
    }

    // 去重：name + domain + path 作为键
    const map = new Map<string, browser.Cookies.Cookie>();
    for (const c of collected) {
        map.set(`${c.name}|${c.domain}|${c.path}`, c);
    }
    const uniques = [...map.values()];
    console.log(`[cookies] total unique=${uniques.length}`);

    // 额外打印关键 cookie 是否存在（便于快速判断登录态）
    const want = ["SAPISID", "__Secure-3PAPISID", "APISID", "SID", "HSID", "SSID"];
    const have = new Set(uniques.map((c) => c.name));
    console.log(
        `[cookies] presence: ` +
        want.map((k) => `${k}=${have.has(k) ? "YES" : "NO"}`).join(", ")
    );

    return uniques;
}