import {logFT} from "./common/debug_flags";
import {postToContent} from "./injection";
import {MsgType} from "./common/consts";

declare global {
    interface Window {
        __tc_extra_fetch_hooked__?: boolean;
        __tc_extra_xhr_hooked__?: boolean;
        __tc_extra_hooks_installed__?: boolean;
        __tc_fetch_guard__?: any;
        __tc_xhr_guard__?: any;
    }
}

/** ===== Debug helpers ===== */
let __tc_req_seq__ = 0;

function __tc_isUserTweetsUrl__(input: any): boolean {
    try {
        const url = typeof input === "string" ? input : String(input);
        return url.includes("/UserTweets");
    } catch {
        return false;
    }
}

function __tc_parseVarsFromUrl__(rawUrl: string): any | null {
    try {
        const u = new URL(rawUrl);
        const v = u.searchParams.get("variables");
        if (!v) return null;
        return JSON.parse(decodeURIComponent(v));
    } catch {
        return null;
    }
}

function __tc_isGraphqlUrl__(input: any): boolean {
    try {
        const url = typeof input === "string" ? input : String(input);
        return url.includes("/i/api/graphql/");
    } catch {
        return false;
    }
}

function __tc_url_of__(input: RequestInfo | URL): string {
    try {
        if (typeof input === "string") return input;
        if (input instanceof URL) return input.toString();
        if (input instanceof Request) return input.url;
        return String((input as any)?.toString?.() ?? input);
    } catch {
        return String(input);
    }
}

/** Hook fetch */
function __tc_installFetchUserTweetsCapture__(): void {
    if (window.__tc_extra_fetch_hooked__) {
        logFT("✅fetch hook already installed");
        return;
    }

    const originalFetch = window.fetch;

    const patchedFetch = async function (
        this: any,
        input: RequestInfo | URL,
        init?: RequestInit
    ): Promise<Response> {
        try {
            const url = __tc_url_of__(input);
            const isGraphql = __tc_isGraphqlUrl__(url);
            const isUserTweets = __tc_isUserTweetsUrl__(url);

            if (!isGraphql || !isUserTweets) return (originalFetch as any).call(this, input, init);

            const vars = __tc_parseVarsFromUrl__(url);
            const reqId = ++__tc_req_seq__;
            let response: Response;

            response = await (originalFetch as any).call(this, input, init);
            const cJson = response.clone();
            const result = await cJson.json();
            logFT(`[F#${reqId}] json ok  result=${result}  for kol:${vars.userId}`);

            postToContent(MsgType.IJUserTweetsCaptured, {tweets: result, kolID: vars.userId});
            return response;
        } catch (e) {
            console.warn(`[F#${__tc_req_seq__}] original fetch failed`, e);
            throw e;
        }
    };

    (window as any).fetch = patchedFetch as typeof window.fetch;
    window.__tc_extra_fetch_hooked__ = true;
    window.__tc_fetch_guard__ = patchedFetch;
    logFT("✅ fetch hook installed");
}

/** Hook XHR */
function __tc_installXHRUserTweetsCapture__(): void {
    if (window.__tc_extra_xhr_hooked__) {
        logFT("✅xhr hook already installed");
        return;
    }

    const OriginalXHR = window.XMLHttpRequest;

    class __TC_XHR_Interceptor__ extends OriginalXHR {
        private __tc_url__: string | null = null;
        private __tc_req_id__: number | null = null;
        private __tc_user_id__: string | null = null;

        open(method: string, url: string, async?: boolean, user?: string | null, password?: string | null) {
            this.__tc_url__ = url;

            if (__tc_isGraphqlUrl__(url)) {
                logFT(`[X] ${method} ${__tc_isUserTweetsUrl__(url) ? "(UserTweets)" : ""} ${url}`);
            }

            if (__tc_isUserTweetsUrl__(url)) {
                this.__tc_req_id__ = ++__tc_req_seq__;
                const vars = __tc_parseVarsFromUrl__(url);
                if (vars) this.__tc_user_id__ = vars.userId;
            }
            return super.open(method, url, async ?? true, user ?? null, password ?? null);
        }

        send(...args: any[]): void {
            if (this.__tc_url__ && __tc_isUserTweetsUrl__(this.__tc_url__)) {
                const reqId = this.__tc_req_id__!;
                this.addEventListener("readystatechange", () => logFT(`[X#${reqId}] rs=${this.readyState}`));
                this.addEventListener("loadstart", () => logFT(`[X#${reqId}] loadstart`));
                this.addEventListener("progress", () => logFT(`[X#${reqId}] progress`));
                this.addEventListener("error", (e) => console.warn(`[X#${reqId}] error`, e));
                this.addEventListener("abort", () => console.warn(`[X#${reqId}] abort`));

                this.addEventListener("load", () => {
                    try {
                        const isText = this.responseType === "" || this.responseType === "text";
                        logFT(`[X#${reqId}] load`, {
                            status: this.status,
                            responseType: this.responseType || "text",
                        });

                        if (isText && this.responseText) {
                            try {
                                const result = JSON.parse(this.responseText) as any;
                                logFT(`[X#${reqId}] text(response) ok, result=${result}  for kol:${this.__tc_user_id__}`);
                                postToContent(MsgType.IJUserTweetsCaptured, {
                                    tweets: result,
                                    kolID: this.__tc_user_id__
                                });
                            } catch (je) {
                                console.warn(`[X#${reqId}] json fail`, je);
                            }
                        } else if (this.responseType === "json" && this.response) {
                            // 兼容：若服务端/页面把 responseType 设成 json
                            try {
                                const result = this.response as any;
                                logFT(`[X#${reqId}] json(response) ok, tweets=${result} for kol:${this.__tc_user_id__}`);
                                postToContent(MsgType.IJUserTweetsCaptured, {
                                    tweets: result,
                                    kolID: this.__tc_user_id__
                                });
                            } catch (je) {
                                console.warn(`[X#${reqId}] json(response) fail`, je);
                            }
                        } else {
                            console.warn(`[X#${reqId}] non-text`, this.responseType);
                        }
                    } catch (err) {
                        console.warn(`[X#${reqId}] load handler error`, err);
                    }
                });
            }

            // @ts-ignore
            return (OriginalXHR.prototype.send as any).apply(this, args);
        }
    }

    // @ts-ignore
    window.XMLHttpRequest = __TC_XHR_Interceptor__;
    window.__tc_extra_xhr_hooked__ = true;
    window.__tc_xhr_guard__ = __TC_XHR_Interceptor__;
    logFT("✅ xhr hook installed");
}

/** Watchdog: 若 hook 被覆盖则自动重装 */
function __tc_startHookWatchdog__(): void {
    const RECHECK_MS = 500;
    setInterval(() => {
        try {
            if ((window as any).fetch !== window.__tc_fetch_guard__) {
                console.warn("fetch hook lost, re-hooking...");
                window.__tc_extra_fetch_hooked__ = false;
                __tc_installFetchUserTweetsCapture__();
            }
            if (window.XMLHttpRequest !== window.__tc_xhr_guard__) {
                console.warn("xhr hook lost, re-hooking...");
                window.__tc_extra_xhr_hooked__ = false;
                __tc_installXHRUserTweetsCapture__();
            }
        } catch (e) {
            console.warn("watchdog error", e);
        }
    }, RECHECK_MS);
}

/** Public init that only adds hooks if not already installed */
export function initUserTweetsCapture(): void {
    if (window.__tc_extra_hooks_installed__) {
        logFT("hooks already installed");
        return;
    }
    logFT("installing hooks...");
    __tc_installFetchUserTweetsCapture__();
    __tc_installXHRUserTweetsCapture__();
    __tc_startHookWatchdog__();
    window.__tc_extra_hooks_installed__ = true;
    logFT("✅ hooks ready");
}
