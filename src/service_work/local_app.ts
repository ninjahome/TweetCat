// ====== 1) 配置：你的 Native Messaging Host 名称 ======
import browser from "webextension-polyfill";
import {sessionGet, sessionSet} from "../common/session_storage";
import {VideoMeta} from "../object/video_meta";
import {logYT} from "../common/debug_flags";

const KS_YT_COOKIE_KEY = "__KS_YT_COOKIE__";
const NATIVE_HOST = 'com.dessage.tweetcatapp';

type NativeAction = 'start' | 'cookie' | 'check' | 'probe' | 'videoMeta';

interface NativeRequest {
    action: NativeAction;
    videoMeta?: VideoMeta;
    cookies?: string;
    hash?: string;
}

interface NativeResponse {
    ok: boolean;
    message?: string;
}

// 计算 SHA256（保持不变）
async function sha256Hex(text: string): Promise<string> {
    const data = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}


// ====== 3) 发送工具：发消息到原生壳子（带超时&错误处理） ======
async function sendToNative(payload: NativeRequest, timeoutMs = 15000): Promise<NativeResponse> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);

    try {
        const resp = await browser.runtime.sendNativeMessage(NATIVE_HOST, payload) as NativeResponse;
        return resp ?? {ok: false, message: 'empty native response'};
    } catch (err: any) {
        return {ok: false, message: String(err?.message || err)};
    } finally {
        clearTimeout(t);
    }
}


export async function openLocalApp(): Promise<boolean> {
    logYT("---------->>> start to open local app");
    const req: NativeRequest = {
        action: 'start',
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
    logYT("---------->>> start to check if local app installed");
    const req: NativeRequest = {
        action: 'check',
    };

    try {
        const resp = await browser.runtime.sendNativeMessage(NATIVE_HOST, req) as NativeResponse;
        return !!(resp && (resp as any).ok === true);
    } catch (err: any) {
        const msg = String(err?.message || err || "").toLowerCase();

        logYT("------>>>local host error message:", msg);
        if (msg.includes("specified native messaging host not found")) {
            return false;
        }

        if (msg.includes("access to the specified native messaging host is forbidden")) {
            return false;
        }

        if (
            msg.includes("native host has exited") ||
            msg.includes("could not establish connection") ||
            msg.includes("error when communicating")
        ) {
            return true;
        }
        return false;
    }
}
