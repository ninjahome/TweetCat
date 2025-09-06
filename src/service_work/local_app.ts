// ====== 1) 配置：你的 Native Messaging Host 名称 ======
import browser from "webextension-polyfill";

const NATIVE_HOST = 'com.dessage.tweetcatapp';
// const NATIVE_HOST = 'com.dessage.ytdlp_bridge';

type NativeAction = 'start' | 'cookie' | 'check' | 'probe';

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
}

interface NativeResponse {
    ok: boolean;
    message?: string;
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

export async function saveSimpleVideo(videoID: string) {
    console.log("---------->>> video id to download", videoID);

    const cookies = await readYouTubeCookies();

    const url = `https://www.youtube.com/watch?v=${videoID}`;
    const req: NativeRequest = {
        action: 'cookie',//probe//cookie
        videoId: videoID,
        url,
        cookies,
    };

    const res = await sendToNative(req);
    if (!res.ok) {
        console.warn('[native][probe] failed:', res.message);
        return;
    }

    console.log('[native] ok:');
}

export async function openLocalApp(): Promise<boolean> {
    console.log("---------->>> start to open local app");
    const req: NativeRequest = {
        action: 'start',
        videoId: ''
    };

    const resp = await sendToNative(req);
    const success = !!(resp && (resp as any).ok === true);
    if (!success) {
        console.warn("failed to open local app:", resp?.message);
        return false;
    }

    return true;
}

export async function checkLocalApp(): Promise<boolean> {
    console.log("---------->>> start to check if local app installed");
    const req: NativeRequest = {
        action: 'check',
        videoId: ''
    };

    try {
        const resp = await browser.runtime.sendNativeMessage(NATIVE_HOST, req) as NativeResponse;
        return !!(resp && (resp as any).ok === true);
    } catch (err: any) {
        const msg = String(err?.message || err || "").toLowerCase();

        console.log("------>>>local host error message:", msg);
        // 1) 没找到 host（清单未放到正确目录 / name 不匹配 / 浏览器不是这个通道）
        if (msg.includes("specified native messaging host not found")) {
            return false;
        }

        // 2) 不允许访问（allowed_origins 的扩展 ID 不匹配）
        if (msg.includes("access to the specified native messaging host is forbidden")) {
            return false;
        }

        // 3) 能找到 host，但沟通失败（host 启动后退出/崩溃/通信异常）：
        //    就“算作已安装”，因为清单与路径都生效了，只是运行异常
        if (
            msg.includes("native host has exited") ||
            msg.includes("could not establish connection") ||
            msg.includes("error when communicating")
        ) {
            return true;
        }

        // 其它未知错误：保守起见当作未安装
        return false;
    }
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