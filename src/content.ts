import browser, {Runtime} from "webextension-polyfill";
import {changeAdsBlockStatus, hidePopupMenu, initObserver} from "./content_oberver";
import {
    appendFilterOnKolProfileHome,
} from "./content_filter";
import {__targetUrlToFilter, maxElmFindTryTimes, MsgType} from "./consts";
import {addCustomStyles, isTwitterUserProfile} from "./utils";
import {TweetKol} from "./object_TweetKol";
import {appendTweetCatMenuItem} from "./content_timeline";

export function isHomePage(): boolean {
    return window.location.href === __targetUrlToFilter;
}

document.addEventListener('DOMContentLoaded', onDocumentLoaded);

async function onDocumentLoaded() {
    addCustomStyles('css/content.css');
    await initObserver();
    await parseUserInfo(async (userName) => {
        console.log("------->>>>tweet user name:", userName);
    });
    appendTweetCatMenuItem();
    console.log('------>>>TweetCat content script success ✨');
}

browser.runtime.onMessage.addListener((request: any, _sender: Runtime.MessageSender, sendResponse: (response?: any) => void): true => {
    return contentMsgDispatch(request, _sender, sendResponse)
});

function contentMsgDispatch(request: any, _sender: Runtime.MessageSender, sendResponse: (response?: any) => void): true {

    switch (request.action) {
        case MsgType.NaviUrlChanged: {
            const kolName = isTwitterUserProfile()
            if (!!kolName) {
                appendFilterOnKolProfileHome(kolName).then();
            }
            checkFilterStatusAfterUrlChanged();
            sendResponse({success: true});
            break;
        }
        case MsgType.CategoryChanged: {
            console.log("------>>> category changed.....")
            // reloadCategoryContainer(request.data as Category[]).then();
            sendResponse({success: true});
            break;
        }
        case MsgType.AdsBlockChanged: {
            changeAdsBlockStatus(request.data as boolean);
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
        console.log("------>>> need load user profile later");

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
        console.log("==============================>>>", username, displayName);
        return null;
    }

    return new TweetKol(username, displayName);
}

function checkFilterStatusAfterUrlChanged() {
    hidePopupMenu();
}