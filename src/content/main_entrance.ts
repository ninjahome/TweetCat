import browser, {Runtime} from "webextension-polyfill";
import {changeAdsBlockStatus, hidePopupMenu, initObserver} from "./twitter_observer";
import {
    appendFilterOnKolProfileHome, appendFilterOnTweetPage,
} from "./twitter_ui";
import {__targetUrlToFilter, maxElmFindTryTimes, MsgType} from "../common/consts";
import {addCustomStyles, observeSimple, parseTwitterPath} from "../common/utils";
import {TweetKol} from "../object/tweet_kol";
import {setupTweetCatMenuAndTimeline} from "./tweetcat_timeline";
import {tweetFetchParam} from "../service_work/tweet_fetch_manager";
import {startToCheckKolId, startToFetchTweets} from "../timeline/tweet_fetcher";
import {setTweetCatFlag} from "../timeline/route_helper";
import {logRender} from "../common/debug_flags";
import {setupFilterItemsOnWeb3Area} from "./tweetcat_web3_area";

export function isHomePage(): boolean {
    return window.location.href === __targetUrlToFilter;
}

document.addEventListener('DOMContentLoaded', onDocumentLoaded);

async function onDocumentLoaded() {
    addCustomStyles('css/content.css');
    addCustomStyles('css/tweet_render.css');
    await initObserver();
    await parseUserInfo(async (userName) => {
        logRender("------->>>>tweet user name:", userName);
    });
    appendTweetCatMenuItem();
    logRender('------>>>TweetCat content script success ✨');
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
            logRender("------>>> link info:", linkInfo)
            if (linkInfo.kind === "profile") {
                appendFilterOnKolProfileHome(linkInfo.username).then();
            } else if (linkInfo.kind === "tweet") {
                appendFilterOnTweetPage(linkInfo.username).then();
            } else {
                setTweetCatFlag(false);
            }
            checkFilterStatusAfterUrlChanged();
            sendResponse({success: true});
            break;
        }
        case MsgType.CategoryChanged: {
            logRender("------>>> category changed.....")
            // reloadCategoryContainer(request.data as Category[]).then();
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

        default:
            sendResponse({success: true});
    }

    return true;
}

let userInfoTryTime = 0;

async function parseUserInfo(callback: (userProfile: string) => Promise<void>) {

    const profileBtn = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]') as HTMLLinkElement;
    if (!profileBtn) {
        logRender("------>>> need load user profile later");

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
        logRender("==============================>>>", username, displayName);
        return null;
    }

    return new TweetKol(username, displayName);
}

function checkFilterStatusAfterUrlChanged() {
    hidePopupMenu();
}