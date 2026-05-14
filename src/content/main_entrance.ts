import browser, { Runtime } from "webextension-polyfill";
import { changeAdsBlockStatus, hidePopupMenu, initObserver } from "./twitter_observer";
import {
    appendFilterOnKolProfilePage, appendScoreInfoToProfilePage,
    notifyFollowResult,
    updateFollowingSnapshotFromInject,
} from "./twitter_ui";
import { maxElmFindTryTimes, MsgType } from "../common/consts";
import { addCustomStyles, observeSimple, parseContentHtml, parseTwitterPath } from "../common/utils";
import { TweetKol } from "../object/tweet_kol";
import { setupTweetCatMenuAndTimeline } from "./tweetcat_timeline";
import { showToastMsg, showDialog } from "./common";
import { t } from "../common/i18n";
import {
    processCapturedHomeLatest, processCapturedTweetDetail,
    processCapturedTweets,
    startToCheckKolId,
    startToFetchTweets
} from "../timeline/tweet_fetcher";
import { getTweetCatFlag, handleLocationChange, navigateToTweetCat } from "../timeline/route_helper";
import { logTPR } from "../common/debug_flags";
import { reloadCategoryContainer, setupFilterItemsOnWeb3Area } from "./tweetcat_web3_area";
import { isTcMessage, TcMessage, tweetFetchParam } from "../common/msg_obj";
import { queryProfileOfTwitterOwner } from "./tweet_user_info";
import { initI18n } from "../common/i18n";
import { performBulkUnfollow, syncFollowingsFromPage, syncOneFollowingsByScreenName } from "../object/following";
import { addTipBtnForTweet } from "./content_x402";
import { UserProfile } from "../object/user_info";
import { saveCurrentUserBlueVStatus } from "../object/blue_v";

document.addEventListener('DOMContentLoaded', onDocumentLoaded);

type ThemeMode = "default" | "dim" | "lightsout";

function setBgMode(mode: ThemeMode): void {
    document.documentElement.setAttribute("data-bg", mode);
}

/** 用 computedStyle 读真实背景色；不要用 .style（那是 inline） */
function detectTwitterTheme(): ThemeMode {
    if (!document.body) {
        setTimeout(detectTwitterTheme, 200);
        return "default"; // 临时返回一个默认值
    }
    let bg = getComputedStyle(document.body).backgroundColor || "";
    
    if (bg === "rgba(0, 0, 0, 0)" || bg === "transparent") {
        const root = document.getElementById("react-root");
        if (root) {
            bg = getComputedStyle(root).backgroundColor || "";
        }
    }

    // 亮色
    if (bg.includes("rgb(255, 255, 255)") || bg.includes("rgba(255, 255, 255")) return "default";
    // 暗色（Twitter 经典深蓝）
    if (bg.includes("rgb(21, 32, 43)") || bg.includes("rgba(21, 32, 43")) return "dim";
    // 黑色（Lights out）
    if (bg.includes("rgb(0, 0, 0)") || bg.includes("rgba(0, 0, 0, 1)")) return "lightsout";
    
    // 兜底：按亮色主题处理
    return "default";
}

export function syncTwitterTheme(): void {
    const themeMod = detectTwitterTheme();
    console.log("------>>>selected mode is:", themeMod);
    setBgMode(themeMod);
}

let __themeObserver: MutationObserver | null = null;

/** 监听 body 的 class/style 变化以同步主题；只注册一次 */
function installThemeObserverOnce(): void {
    if (__themeObserver) return;
    __themeObserver = new MutationObserver(() => {
        syncTwitterTheme();
    });
    __themeObserver.observe(document.body, {
        attributes: true,
        attributeFilter: ["class", "style"],
    });
    // 初次同步
    syncTwitterTheme();
}


let isVerifyMode = false;

async function onDocumentLoaded() {
    initI18n();

    // Check for verification mode in URL
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("tc_verify") === "1") {
        isVerifyMode = true;
        console.log("[TweetCat] Verification mode active");
    }

    addCustomStyles('css/content.css');
    addCustomStyles('css/tweet_render.css');
    addCustomStyles('css/x402.css');
    await initObserver();

    setTimeout(() => {
        installThemeObserverOnce();
    }, 2_000);

    await parseUserInfo(async (userName) => {
        logTPR("------->>>>tweet user name:", userName);
    });
    appendTweetCatMenuItem();
    queryProfileOfTwitterOwner();
    logTPR('------>>>TweetCat content script success ✨');

    // Trigger initial navigation handling for cold start
    handleNaviUrlChanged();
}

function appendTweetCatMenuItem() {
    observeSimple(
        document.body,
        () => document.querySelector("header nav[role='navigation']") as HTMLElement,
        (nav) => {
            if (nav.querySelector(".tweetCatMenuItem")) return true;
            parseContentHtml("html/content.html").then(async (tpl) => {
                const main = document.querySelector("main[role='main']") as HTMLElement;
                setupTweetCatMenuAndTimeline(nav, tpl, main);
                await setupFilterItemsOnWeb3Area(tpl, main)
            });
            return true;
        }
    );
}

browser.runtime.onMessage.addListener((request: any, _sender: Runtime.MessageSender, sendResponse: (response?: any) => void): true => {
    return contentMsgDispatch(request, _sender, sendResponse)
});

function contentMsgDispatch(request: any, _sender: Runtime.MessageSender, sendResponse: (response?: any) => void): true {

    const type = request?.action ?? request?.type;

    switch (type) {
        case MsgType.NaviUrlChanged: {
            handleNaviUrlChanged();
            sendResponse({ success: true });
            break;
        }
        case MsgType.CategoryChanged: {
            logTPR("------>>> category changed.....")
            reloadCategoryContainer(request.data).then();
            sendResponse({ success: true });
            break;
        }
        case MsgType.AdsBlockChanged: {
            changeAdsBlockStatus(request.data as boolean);
            sendResponse({ success: true });
            break;
        }

        case MsgType.StartTweetsFetch: {
            startToFetchTweets(request.data as tweetFetchParam).then()
            sendResponse({ success: true });
            break;
        }

        case MsgType.StartKolIdCheck: {
            startToCheckKolId(request.data).then()
            sendResponse({ success: true });
            break;
        }

        case MsgType.FollowingSync: {
            syncFollowingsFromPage()
                .then((followings) => {
                    sendResponse({ success: true, data: followings });
                })
                .catch((err: Error) => {
                    sendResponse({ success: false, data: err?.message ?? "Failed to sync followings." });
                });
            return true;
        }

        case MsgType.FollowingBulkUnfollow: {
            performBulkUnfollow(request.data)
                .then((result) => sendResponse({ success: true, data: result }))
                .catch((err) =>
                    sendResponse({
                        success: false,
                        error: err?.message ?? "Failed to unfollow selected accounts.",
                    }),
                );
            return true;
        }

        case MsgType.FollowingFetchOne: {
            syncOneFollowingsByScreenName(request.data as string)
                .then((result) => sendResponse({ success: true, data: result }))
                .catch((err) =>
                    sendResponse({
                        success: false,
                        error: err?.message ?? "Failed to fetch selected accounts.",
                    }),
                );
            return true;
        }

        default:
            sendResponse({ success: true });
    }

    return true;
}


let userInfoTryTime = 0;

async function parseUserInfo(callback: (userProfile: string) => Promise<void>) {

    const profileBtn = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]') as HTMLLinkElement;
    if (!profileBtn) {
        logTPR("------>>> need load user profile later");

        userInfoTryTime += 1;
        if (userInfoTryTime > maxElmFindTryTimes) {
            console.warn("------>>> failed find user button");
            userInfoTryTime = 0;
            return;
        }

        setTimeout(() => {
            parseUserInfo(callback);
        }, 3000);
        return;
    }
    await callback(profileBtn.href);
}

export function parseNameFromTweetCell(tweetNode: HTMLElement): TweetKol | null {
    const userNameDiv = tweetNode.querySelector('div[data-testid="User-Name"] a[role="link"]') as HTMLElement;

    if (!userNameDiv) {
        return null;
    }

    const userHref = userNameDiv?.getAttribute('href') || '';
    const username = userHref.startsWith('/') ? userHref.substring(1) : userHref;

    const nameSpan = userNameDiv.querySelector(".css-1jxf684.r-bcqeeo.r-1ttztb7.r-qvutc0.r-poiln3") as HTMLElement
    const displayName = nameSpan?.textContent || 'imageName';
    if (!username || !displayName) {
        logTPR("==============================>>>", username, displayName);
        return null;
    }

    return new TweetKol(username, displayName);
}

function checkFilterStatusAfterUrlChanged() {
    hidePopupMenu();
}

function handleNaviUrlChanged() {
    const linkInfo = parseTwitterPath(window.location.href)
    logTPR("------>>> handleNaviUrlChanged, link info:", linkInfo)
    if (linkInfo.kind === "profile") {
        appendFilterOnKolProfilePage(linkInfo.username).then();
    } else if (linkInfo.kind === "home" || linkInfo.kind === "explore") {
        if (getTweetCatFlag()) {
            navigateToTweetCat();
        }
    } else if (linkInfo.kind === "tweet") {
        console.log("------>>>link info:", linkInfo)
        addTipBtnForTweet(linkInfo.tweetId)
    }
    checkFilterStatusAfterUrlChanged();
}


window.addEventListener('message', (e) => {
    const msg = e.data as TcMessage;
    if (isTcMessage(msg)) {
        switch (msg.action) {
            case MsgType.IJLocationChange: {
                handleLocationChange();
                break;
            }
            case MsgType.IJUserTweetsCaptured: {
                const d = msg.data;
                processCapturedTweets(d.tweets as any, d.kolID as string).then();
                break;
            }
            case MsgType.IJHomeLatestCaptured: {
                processCapturedHomeLatest(msg.data).then()
                break;
            }
            case MsgType.IJTweetDetailCaptured: {
                processCapturedTweetDetail(msg.data).then()
                break;
            }
            case MsgType.IJUserByScreenNameCaptured: {
                const data = msg.data;

                // Forward to Background for Blue V status check
                try {
                    browser.runtime.sendMessage(msg).catch(() => { });
                } catch (e) { /* ignore */ }

                // Check if it's a full profile or just lightweight status
                if (data.profile && typeof data.profile.isFollowing === 'boolean' && !data.profile.data) {
                    console.log("[Content] Lightweight following update for", data.screenName, data.profile.isFollowing);
                    updateFollowingSnapshotFromInject(data.screenName, data.profile.isFollowing);
                } else {
                    try {
                        const usrProfile = new UserProfile(data.profile);
                        appendScoreInfoToProfilePage(usrProfile, data.screenName).then();
                        updateFollowingSnapshotFromInject(data.screenName, usrProfile.isFollowing);

                        // 每次看到 Profile 都由背景脚本静默保存蓝V状态到 DB
                        // (通过已经在上面执行的 sendMessage(msg) 实现)

                        // 如果是显式验证模式，展示对话框反馈
                        if (isVerifyMode) {
                            if (usrProfile.isBlueVerified) {
                                showDialog(t('tips_title'), "✅ Verification Success! You are eligible for tasks. Return to the plugin to continue.");
                            } else {
                                showDialog(t('tips_title'), "❌ Verification Failed: You are not a Blue Verified user. Tasks cannot be started.");
                            }
                            isVerifyMode = false; // 重置模式
                        }
                    } catch (e) {
                        console.warn("Failed to parse user profile:", e);
                    }
                }
                break;
            }
            case MsgType.IJProfileSpotlightsCaptured: {
                console.log(">>>>>>>>>> [INTERCEPTED: ProfileSpotlightsQuery] <<<<<<<<<<");
                console.log("ScreenName:", msg.data.screenName);
                console.log("Full Raw Data:", JSON.stringify(msg.data.data, null, 2));
                console.log(">>>>>>>>>>>>>>>>>>>>>>>>>>>><<<<<<<<<<<<<<<<<<<<<<<<<<<<<<");

                // Forward to Background for Blue V status check
                try {
                    browser.runtime.sendMessage(msg).catch(() => { });
                } catch (e) { /* ignore */ }

                break;
            }
            case MsgType.IJFollowActionCaptured: {
                console.log(`[Content] Follow action result intercepted for @${msg.data.screenName}: success=${msg.data.success}`);
                if (msg.data.success) {
                    updateFollowingSnapshotFromInject(msg.data.screenName, true);
                }
                notifyFollowResult(msg.data.success);
                break;
            }
            case MsgType.IJUnfollowActionCaptured: {
                console.log(`[Content] Unfollow action result intercepted for @${msg.data.screenName}: success=${msg.data.success}`);
                if (msg.data.success) {
                    updateFollowingSnapshotFromInject(msg.data.screenName, false);
                }
                break;
            }
            default: {
                console.warn("⚠️ content message unknown message:", msg);
                return;
            }
        }
        return;
    }
});
