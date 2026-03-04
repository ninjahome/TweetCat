import { CreateFriendship, DestroyFriendship, HomeLatestTimeline, HomeTimeline, MsgType, ProfileSpotlightsQuery, TweetDetail, UserByScreenName, UserTweets } from "./common/consts";
import { logIC } from "./common/debug_flags";
import { postWindowMsg } from "./common/msg_obj";

declare global {
    interface Window {
        ytExtraHooksInstalled?: boolean;
        ytHasPatchedFetch?: boolean;
        ytPatchedFetch?: any;
        ytHasPatchedXHR?: boolean;
        ytPatchedXHR?: any;
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

        if (url.includes("/" + UserByScreenName)) {
            return UserByScreenName;
        }



        if (url.includes("/" + ProfileSpotlightsQuery)) {
            return ProfileSpotlightsQuery;
        }

        // 兼容 GraphQL (CreateFriendship) 和 传统 REST (/friendships/create.json)
        if (url.includes("/CreateFriendship") || url.includes("/friendships/create.json")) {
            return CreateFriendship;
        }

        if (url.includes("/DestroyFriendship") || url.includes("/DeleteFriendship") || url.includes("/Unfollow") || url.includes("/friendships/destroy.json")) {
            return DestroyFriendship;
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
function __tc_installFetch__(): void {
    if (window.ytHasPatchedFetch) {
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
            const isLegacyFollow = url.includes("/i/api/1.1/friendships/");
            const timeType = __tc_isTargetTimelineUrl__(url);

            if ((!isGraphql && !isLegacyFollow) || !timeType) return (originalFetch as any).call(this, input, init);

            const reqId = ++__tc_req_seq__;
            let response: Response;

            response = await (originalFetch as any).call(this, input, init);
            const cJson = response.clone();
            const result = await cJson.json();

            if (timeType === UserTweets) {
                const vars = __tc_parseVarsFromUrl__(url);
                logIC(`[F#${reqId}] tweets result=${result}  for kol:${vars.userId}`);
                postWindowMsg(MsgType.IJUserTweetsCaptured, { tweets: result, kolID: vars.userId });
            } else if (timeType === HomeLatestTimeline || timeType === HomeTimeline) {
                logIC(`[F#${reqId}] home latest result result=${result}`);
                postWindowMsg(MsgType.IJHomeLatestCaptured, result);
            } else if (timeType === TweetDetail) {
                postWindowMsg(MsgType.IJTweetDetailCaptured, result);
            } else if (timeType === UserByScreenName) {
                const vars = __tc_parseVarsFromUrl__(url);
                const screenName = vars?.screen_name ?? vars?.screenName ?? "(unknown)";
                logIC(`[F#${reqId}] userByScreenName result for @${screenName}`, result);
                postWindowMsg(MsgType.IJUserByScreenNameCaptured, { profile: result, screenName });
            } else if (timeType === ProfileSpotlightsQuery) {
                const vars = __tc_parseVarsFromUrl__(url);
                const screenName = vars?.screen_name ?? vars?.screenName ?? "(unknown)";
                const isFollowing = result?.data?.user_result_by_screen_name?.result?.relationship_perspectives?.following;
                logIC(`[F#${reqId}] ProfileSpotlightsQuery @${screenName} isFollowing=${isFollowing}`);

                // Send 1: Update status immediately
                if (typeof isFollowing === "boolean") {
                    postWindowMsg(MsgType.IJUserByScreenNameCaptured, {
                        profile: { isFollowing },
                        screenName,
                    });
                }

                postWindowMsg(MsgType.IJProfileSpotlightsCaptured, {
                    data: result,
                    screenName,
                });
            } else if (timeType === CreateFriendship) {
                // 兼容 GraphQL 和 Legacy 结构
                const following = result?.data?.create_friendship?.legacy?.following ?? result?.following;
                const screenName = result?.data?.create_friendship?.legacy?.screen_name ?? result?.screen_name ?? "(unknown)";
                const idStr = result?.data?.create_friendship?.legacy?.id_str ?? result?.id_str;

                // 诊断日志：打印所有 Key
                console.log(`>>>> [DIAGNOSTIC: Follow API Keys] <<<<`, Object.keys(result || {}));
                if (result?.data?.create_friendship) console.log(`>>>> [DIAGNOSTIC: GQL Data Keys] <<<<`, Object.keys(result.data.create_friendship));

                // 鲁棒性判定：如果是 friendships/create 接口且返回了 id_str，说明操作已成功执行
                const isSuccess = (following === true) || !!idStr;

                logIC(`[F#${reqId}] Follow Action Captured: @${screenName}, following=${following}, hasId=${!!idStr} -> success=${isSuccess}`);

                postWindowMsg(MsgType.IJFollowActionCaptured, {
                    success: isSuccess,
                    screenName,
                });
            } else if (timeType === DestroyFriendship) {
                // 兼容 GraphQL 和 Legacy 结构
                const following = result?.data?.destroy_friendship?.legacy?.following ?? result?.following;
                const screenName = result?.data?.destroy_friendship?.legacy?.screen_name ?? result?.screen_name ?? "(unknown)";

                // 如果 following 为 false，或者返回了用户信息说明操作成功
                const isSuccess = (following === false) || !!(result?.id_str || result?.data?.destroy_friendship?.legacy?.id_str);

                logIC(`[F#${reqId}] Unfollow Action Captured: @${screenName}, following=${following} -> success=${isSuccess}`);

                postWindowMsg(MsgType.IJUnfollowActionCaptured, {
                    success: isSuccess,
                    screenName,
                });
            }

            return response;
        } catch (e) {
            console.warn(`[F#${__tc_req_seq__}] original fetch failed`, e);
            throw e;
        }
    };

    (window as any).fetch = patchedFetch as typeof window.fetch;
    window.ytHasPatchedFetch = true;
    window.ytPatchedFetch = patchedFetch;
    logIC("✅ fetch hook installed");
}

/** Hook XHR */
function __tc_installXHR__(): void {
    if (window.ytHasPatchedXHR) {
        logIC("✅xhr hook already installed");
        return;
    }

    const OriginalXHR = window.XMLHttpRequest;

    class __TC_XHR_Interceptor__ extends OriginalXHR {
        private __tc_url__: string | null = null;
        private __tc_req_id__: number | null = null;
        private __tc_user_id__: string | null = null;
        private __tc_screen_name__: string | null = null;

        open(method: string, url: string, async?: boolean, user?: string | null, password?: string | null) {
            this.__tc_url__ = url;

            if (__tc_isTargetTimelineUrl__(url)) {
                this.__tc_req_id__ = ++__tc_req_seq__;
                const vars = __tc_parseVarsFromUrl__(url);
                if (vars) {
                    this.__tc_user_id__ = vars.userId ?? null;
                    this.__tc_screen_name__ = vars.screen_name ?? vars.screenName ?? null; // + 新增
                }
                logIC(`[X] ${method} ${url}`);
            }
            return super.open(method, url, async ?? true, user ?? null, password ?? null);
        }

        send(...args: any[]): void {
            const timeType = __tc_isTargetTimelineUrl__(this.__tc_url__);
            const isGraphql = __tc_isGraphqlUrl__(this.__tc_url__);
            const isLegacyFollow = this.__tc_url__?.includes("/i/api/1.1/friendships/");

            // If it's not a GraphQL request and not a legacy follow request, then skip.
            // Also, if it's a legacy follow but not identified as CreateFriendship, skip.
            if ((!isGraphql && !isLegacyFollow) || (isLegacyFollow && timeType !== CreateFriendship)) {
                return (OriginalXHR.prototype.send as any).apply(this, args);
            }

            // If it's a GraphQL request, but not one of our target types, skip.
            if (isGraphql && (timeType !== UserTweets
                && timeType !== HomeLatestTimeline
                && timeType !== HomeTimeline
                && timeType !== TweetDetail
                && timeType !== UserByScreenName
                && timeType !== ProfileSpotlightsQuery
                && timeType !== CreateFriendship
                && timeType !== DestroyFriendship)) {
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
                        postWindowMsg(MsgType.IJUserTweetsCaptured, {
                            tweets: result,
                            kolID: this.__tc_user_id__
                        });
                    } else if (timeType === HomeLatestTimeline || timeType === HomeTimeline) {
                        logIC(`[X#${reqId}] home time line result=${result}`);
                        postWindowMsg(MsgType.IJHomeLatestCaptured, result);
                    } else if (timeType === TweetDetail) {
                        postWindowMsg(MsgType.IJTweetDetailCaptured, result);
                    } else if (timeType === UserByScreenName) {
                        const screenName = this.__tc_screen_name__ ?? "(unknown)";
                        logIC(`[X#${reqId}] userByScreenName result for @${screenName}`, result);
                        postWindowMsg(MsgType.IJUserByScreenNameCaptured, {
                            profile: result,
                            screenName,
                        });
                    } else if (timeType === ProfileSpotlightsQuery) {
                        const isFollowing = result?.data?.user_result_by_screen_name?.result?.relationship_perspectives?.following;
                        const screenName = this.__tc_screen_name__ ?? "(unknown)";
                        logIC(`[X#${reqId}] ProfileSpotlightsQuery @${screenName} isFollowing=${isFollowing}`);

                        if (typeof isFollowing === "boolean") {
                            postWindowMsg(MsgType.IJUserByScreenNameCaptured, {
                                profile: { isFollowing },
                                screenName,
                            });
                        }

                        postWindowMsg(MsgType.IJProfileSpotlightsCaptured, {
                            data: result,
                            screenName,
                        });
                    } else if (timeType === CreateFriendship) {
                        const following = result?.data?.create_friendship?.legacy?.following ?? result?.following;
                        const screenName = result?.data?.create_friendship?.legacy?.screen_name ?? result?.screen_name ?? "(unknown)";
                        const idStr = result?.data?.create_friendship?.legacy?.id_str ?? result?.id_str;

                        // 诊断日志
                        console.log(`>>>> [DIAGNOSTIC: Follow API Keys (XHR)] <<<<`, Object.keys(result || {}));

                        const isSuccess = (following === true) || !!idStr;

                        logIC(`[X#${reqId}] Follow Action Captured: @${screenName}, following=${following}, hasId=${!!idStr} -> success=${isSuccess}`);

                        postWindowMsg(MsgType.IJFollowActionCaptured, {
                            success: isSuccess,
                            screenName,
                        });
                    } else if (timeType === DestroyFriendship) {
                        const following = result?.data?.destroy_friendship?.legacy?.following ?? result?.following;
                        const screenName = result?.data?.destroy_friendship?.legacy?.screen_name ?? result?.screen_name ?? "(unknown)";

                        const isSuccess = (following === false) || !!(result?.id_str || result?.data?.destroy_friendship?.legacy?.id_str);

                        logIC(`[X#${reqId}] Unfollow Action Captured: @${screenName}, following=${following} -> success=${isSuccess}`);

                        postWindowMsg(MsgType.IJUnfollowActionCaptured, {
                            success: isSuccess,
                            screenName,
                        });
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
    window.ytHasPatchedXHR = true;
    window.ytPatchedXHR = __TC_XHR_Interceptor__;
    logIC("✅ xhr hook installed");
}

/** Watchdog: 若 hook 被覆盖则自动重装 */
function __tc_startHookWatchdog__(): void {
    const RECHECK_MS = 500;
    setInterval(() => {
        try {
            if ((window as any).fetch !== window.ytPatchedFetch) {
                console.warn("fetch hook lost, re-hooking...");
                window.ytHasPatchedFetch = false;
                __tc_installFetch__();
            }
            if (window.XMLHttpRequest !== window.ytPatchedXHR) {
                console.warn("xhr hook lost, re-hooking...");
                window.ytHasPatchedXHR = false;
                __tc_installXHR__();
            }
        } catch (e) {
            console.warn("watchdog error", e);
        }
    }, RECHECK_MS);
}

/** Public init that only adds hooks if not already installed */
export function initUserTweetsCapture(): void {
    if (window.ytExtraHooksInstalled) {
        logIC("hooks already installed");
        return;
    }
    logIC("installing hooks...");
    __tc_installFetch__();
    __tc_installXHR__();
    __tc_startHookWatchdog__();
    window.ytExtraHooksInstalled = true;
    logIC("✅ hooks ready");
}
