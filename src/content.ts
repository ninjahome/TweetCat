import browser, {Runtime} from "webextension-polyfill";
import {initObserver} from "./content_oberver";
import {prepareFilterBtn} from "./content_filter";
import {initKolAndCatCache} from "./category";
import {maxElmFindTryTimes, MsgType} from "./consts";
import {addCustomStyles} from "./utils";
import {checkAndInitDatabase} from "./database";

export let contentTemplate: HTMLTemplateElement;

async function parseContentHtml(htmlFilePath: string): Promise<HTMLTemplateElement> {
    const response = await fetch(browser.runtime.getURL(htmlFilePath));
    if (!response.ok) {
        throw new Error(`Failed to fetch ${htmlFilePath}: ${response.statusText}`);
    }
    const htmlContent = await response.text();
    const template = document.createElement('template');
    template.innerHTML = htmlContent;
    return template;
}

document.addEventListener('DOMContentLoaded', async () => {
    await checkAndInitDatabase();

    addCustomStyles('css/content.css');
    contentTemplate = await parseContentHtml('html/content.html');
    initObserver();

    await initKolAndCatCache();
    await prepareFilterBtn();
    await parseUserInfo(async (userName) => { console.log("------->>>>tweet user name:",userName)});

    console.log('------>>>TweetCat content script success ✨');
});

browser.runtime.onMessage.addListener((request: any, _sender: Runtime.MessageSender, sendResponse: (response?: any) => void): true => {
    return contentMsgDispatch(request, _sender, sendResponse)
});

function contentMsgDispatch(request: any, _sender: Runtime.MessageSender, sendResponse: (response?: any) => void): true {

    switch (request.action) {
        case MsgType.NaviUrlChanged:
            prepareFilterBtn().then();
            sendResponse({success: true});
            break;
        default:
            sendResponse({success: true});
    }

    return true;
}

let userInfoTryTime = 0;

async function parseUserInfo(callback: (userName: string) => Promise<void>) {

    const userButton = document.querySelector('button[data-testid="SideNav_AccountSwitcher_Button"]');
    const userNameStr = userButton?.querySelector(".css-175oi2r.r-1wbh5a2.r-dnmrzs.r-1ny4l3l")?.textContent?.trim();
    if (!userNameStr) {
        console.log("------>>> need load user button later");

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

    await callback(userNameStr);
}