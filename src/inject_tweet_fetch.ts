import {logIC} from "./common/debug_flags";
import {postToContent} from "./injection";
import {HomeLatestTimeline, HomeTimeline, MsgType, TweetDetail, UserTweets} from "./common/consts";

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

function __tc_isTargetTimelineUrl__(input: any): string | null {
    try {
        const url = typeof input === "string" ? input : String(input);
        if (url.includes("/" + UserTweets)) {
            return UserTweets;
        }
        if (url.includes("/" + HomeLatestTimeline)) {
            return HomeLatestTimeline;
        }
        if (url.includes("/" + HomeTimeline)) {
            return HomeTimeline;
        }

        if (url.includes("/" + TweetDetail)) {
            return TweetDetail;
        }

        return null;
    } catch {
        return null;
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
        logIC("✅fetch hook already installed");
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
            const timeType = __tc_isTargetTimelineUrl__(url);

            if (!isGraphql || !timeType) return (originalFetch as any).call(this, input, init);

            const reqId = ++__tc_req_seq__;
            let response: Response;

            response = await (originalFetch as any).call(this, input, init);
            const cJson = response.clone();
            const result = await cJson.json();

            if (timeType === UserTweets) {
                const vars = __tc_parseVarsFromUrl__(url);
                logIC(`[F#${reqId}] tweets result=${result}  for kol:${vars.userId}`);
                postToContent(MsgType.IJUserTweetsCaptured, {tweets: result, kolID: vars.userId});
            } else if (timeType === HomeLatestTimeline || timeType === HomeTimeline) {
                logIC(`[F#${reqId}] home latest result result=${result}`);
                postToContent(MsgType.IJHomeLatestCaptured, result);
            } else if (timeType === TweetDetail) {
                postToContent(MsgType.IJTweetDetailCaptured, result);
            }

            return response;
        } catch (e) {
            console.warn(`[F#${__tc_req_seq__}] original fetch failed`, e);
            throw e;
        }
    };

    (window as any).fetch = patchedFetch as typeof window.fetch;
    window.__tc_extra_fetch_hooked__ = true;
    window.__tc_fetch_guard__ = patchedFetch;
    logIC("✅ fetch hook installed");
}

/** Hook XHR */
function __tc_installXHRUserTweetsCapture__(): void {
    if (window.__tc_extra_xhr_hooked__) {
        logIC("✅xhr hook already installed");
        return;
    }

    const OriginalXHR = window.XMLHttpRequest;

    class __TC_XHR_Interceptor__ extends OriginalXHR {
        private __tc_url__: string | null = null;
        private __tc_req_id__: number | null = null;
        private __tc_user_id__: string | null = null;

        open(method: string, url: string, async?: boolean, user?: string | null, password?: string | null) {
            this.__tc_url__ = url;

            if (__tc_isTargetTimelineUrl__(url)) {
                this.__tc_req_id__ = ++__tc_req_seq__;
                const vars = __tc_parseVarsFromUrl__(url);
                if (vars) this.__tc_user_id__ = vars.userId;
                logIC(`[X] ${method} ${url}`);
            }
            return super.open(method, url, async ?? true, user ?? null, password ?? null);
        }

        send(...args: any[]): void {
            const timeType = __tc_isTargetTimelineUrl__(this.__tc_url__);
            if (!timeType || (timeType !== HomeLatestTimeline
                && timeType !== UserTweets && timeType !== HomeTimeline && timeType !== TweetDetail)) {
                return (OriginalXHR.prototype.send as any).apply(this, args);
            }

            const reqId = this.__tc_req_id__!;
            this.addEventListener("readystatechange", () => logIC(`[X#${reqId}] rs=${this.readyState}`));
            this.addEventListener("loadstart", () => logIC(`[X#${reqId}] loadstart`));
            this.addEventListener("progress", () => logIC(`[X#${reqId}] progress`));
            this.addEventListener("error", (e) => console.warn(`[X#${reqId}] error`, e));
            this.addEventListener("abort", () => console.warn(`[X#${reqId}] abort`));

            this.addEventListener("load", () => {
                try {
                    const isText = this.responseType === "" || this.responseType === "text";
                    logIC(`[X#${reqId}] load`, {
                        status: this.status,
                        responseType: this.responseType || "text",
                    });

                    let result: any | undefined;
                    if (isText && this.responseText) {
                        result = JSON.parse(this.responseText) as any;
                    } else if (this.responseType === "json" && this.response) {
                        result = this.response as any;
                    }
                    if (!result) {
                        console.warn(`[X#${reqId}] no result parsed, skip`);
                        return;
                    }

                    if (timeType === UserTweets) {
                        logIC(`[X#${reqId}] result=${result}  for kol:${this.__tc_user_id__}`);
                        postToContent(MsgType.IJUserTweetsCaptured, {
                            tweets: result,
                            kolID: this.__tc_user_id__
                        });
                    } else if (timeType === HomeLatestTimeline || timeType === HomeTimeline) {
                        logIC(`[X#${reqId}] home time line result=${result}`);
                        postToContent(MsgType.IJHomeLatestCaptured, result);
                    } else if (timeType === TweetDetail) {
                        postToContent(MsgType.IJTweetDetailCaptured, result);
                    }

                } catch (err) {
                    console.warn(`[X#${reqId}] load handler error`, err);
                }
            });

            // @ts-ignore
            return (OriginalXHR.prototype.send as any).apply(this, args);
        }
    }

    // @ts-ignore
    window.XMLHttpRequest = __TC_XHR_Interceptor__;
    window.__tc_extra_xhr_hooked__ = true;
    window.__tc_xhr_guard__ = __TC_XHR_Interceptor__;
    logIC("✅ xhr hook installed");
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
        logIC("hooks already installed");
        return;
    }
    logIC("installing hooks...");
    __tc_installFetchUserTweetsCapture__();
    __tc_installXHRUserTweetsCapture__();
    __tc_startHookWatchdog__();
    window.__tc_extra_hooks_installed__ = true;
    logIC("✅ hooks ready");
}
