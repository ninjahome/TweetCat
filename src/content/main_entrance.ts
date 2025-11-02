import browser, {Runtime} from "webextension-polyfill";
import {changeAdsBlockStatus, hidePopupMenu, initObserver} from "./twitter_observer";
import {
    appendFilterOnKolProfilePage, appendScoreInfoToProfilePage,
} from "./twitter_ui";
import {maxElmFindTryTimes, MsgType} from "../common/consts";
import {addCustomStyles, observeSimple, parseTwitterPath} from "../common/utils";
import {TweetKol} from "../object/tweet_kol";
import {setupTweetCatMenuAndTimeline} from "./tweetcat_timeline";
import {
    processCapturedHomeLatest, processCapturedTweetDetail,
    processCapturedTweets,
    startToCheckKolId,
    startToFetchTweets
} from "../timeline/tweet_fetcher";
import {getTweetCatFlag, handleLocationChange, navigateToTweetCat} from "../timeline/route_helper";
import {logTPR} from "../common/debug_flags";
import {reloadCategoryContainer, setupFilterItemsOnWeb3Area} from "./tweetcat_web3_area";
import {isTcMessage, TcMessage, tweetFetchParam} from "../common/msg_obj";
import {queryProfileOfTwitterOwner} from "./tweet_user_info";
import {initI18n} from "../common/i18n";
import {fetchFollowingPage, getUserByUsername} from "../timeline/twitter_api";
import {FollowingUser} from "../object/following";

document.addEventListener('DOMContentLoaded', onDocumentLoaded);

type ThemeMode = "default" | "dim" | "lightsout";

function setBgMode(mode: ThemeMode): void {
    document.documentElement.setAttribute("data-bg", mode);
}

/** 用 computedStyle 读真实背景色；不要用 .style（那是 inline） */
function detectTwitterTheme(): ThemeMode {
    if (!document.body) {
        setTimeout(detectTwitterTheme, 200);
        return "lightsout"; // 临时返回一个默认值
    }
    const bg = getComputedStyle(document.body).backgroundColor || "";
    // 亮色
    if (bg.includes("255, 255, 255")) return "default";
    // 暗色（Twitter 经典深蓝）
    if (bg.includes("21, 32, 43")) return "dim";
    // 黑色（Lights out）
    if (bg.includes("0, 0, 0")) return "lightsout";
    // 兜底：按更深主题处理
    return "lightsout";
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


async function onDocumentLoaded() {
    initI18n();
    addCustomStyles('css/content.css');
    addCustomStyles('css/tweet_render.css');
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

    switch (request.action) {
        case MsgType.NaviUrlChanged: {
            const linkInfo = parseTwitterPath(window.location.href)
            logTPR("------>>> link info:", linkInfo)
            if (linkInfo.kind === "profile") {
                appendFilterOnKolProfilePage(linkInfo.username).then();
            } else if (linkInfo.kind === "home" || linkInfo.kind === "explore") {
                if (getTweetCatFlag()) {
                    navigateToTweetCat();
                }
            }
            checkFilterStatusAfterUrlChanged();
            sendResponse({success: true});
            break;
        }
        case MsgType.CategoryChanged: {
            logTPR("------>>> category changed.....")
            reloadCategoryContainer(request.data).then();
            sendResponse({success: true});
            break;
        }
        case MsgType.AdsBlockChanged: {
            changeAdsBlockStatus(request.data as boolean);
            sendResponse({success: true});
            break;
        }

        case MsgType.StartTweetsFetch: {
            startToFetchTweets(request.data as tweetFetchParam).then()
            sendResponse({success: true});
            break;
        }

        case MsgType.StartKolIdCheck: {
            startToCheckKolId(request.data).then()
            sendResponse({success: true});
            break;
        }

        case MsgType.FollowingSync: {
            (async () => {
                try {
                    const followings = await syncFollowingsFromPage();
                    sendResponse({success: true, data: followings});
                } catch (e) {
                    const err = e as Error;
                    sendResponse({success: false, data: err.message});
                }
            })();
            return true;
        }

        default:
            sendResponse({success: true});
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

export async function parseContentHtml(htmlFilePath: string): Promise<HTMLTemplateElement> {
    const response = await fetch(browser.runtime.getURL(htmlFilePath));
    if (!response.ok) {
        throw new Error(`Failed to fetch ${htmlFilePath}: ${response.statusText}`);
    }
    const htmlContent = await response.text();
    const template = document.createElement('template');
    template.innerHTML = htmlContent;
    return template;
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

async function syncFollowingsFromPage(): Promise<FollowingUser[]> {
    const screenName = await resolveViewerScreenName();
    if (!screenName) {
        throw new Error('Unable to determine current user. Please open your Twitter profile.');
    }

    const profile = await getUserByUsername(screenName);
    const userId = profile?.userId;
    if (!userId) {
        throw new Error('Failed to resolve user id for current account.');
    }

    const collected: FollowingUser[] = [];
    const visited = new Set<string>();
    let cursor: string | undefined = undefined;
    let pageCount = 0;

    while (true) {
        const page = await fetchFollowingPage(userId, 100, cursor);
        for (const user of page.users) {
            if (visited.has(user.userID)) continue;
            visited.add(user.userID);
            collected.push({
                id: user.userID,
                name: user.name,
                screenName: user.screen_name,
                avatarUrl: user.avatarUrl,
            });
        }

        if (!page.nextCursor || page.terminatedBottom) {
            break;
        }

        cursor = page.nextCursor;
        pageCount += 1;
        if (pageCount > 200) { // safety guard
            console.warn('------>>> Following sync reached page limit, stopping early.');
            break;
        }
        await delay(350); // avoid hitting rate limits
    }

    return collected;
}

async function resolveViewerScreenName(maxRetries: number = 10): Promise<string | null> {
    for (let i = 0; i < maxRetries; i++) {
        const profileLink = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]') as HTMLAnchorElement | null;
        if (profileLink?.href) {
            try {
                const url = new URL(profileLink.href);
                const username = url.pathname.replace(/^\//, '').trim();
                if (username) {
                    return username;
                }
            } catch {
                // ignore parse errors
            }
        }
        await delay(500);
    }
    return null;
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
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
                appendScoreInfoToProfilePage(data.profile, data.screenName);
                break;
            }
            default: {
                console.warn("⚠️content message unknown message:", msg);
                return;
            }
        }
        return;
    }
});
