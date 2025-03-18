import browser, {Runtime} from "webextension-polyfill";
import {observerTweetList} from "./content_oberver";
import {checkFilterBtn, prepareFilterHtmlElm} from "./content_filter";
import {loadCategoriesFromDB} from "./content_category";
import {MsgType} from "./consts";

export let contentTemplate:HTMLTemplateElement;

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
    console.log('------>>>TweetCat content script success ✨');
    contentTemplate = await parseContentHtml('html/content.html');
    loadCategoriesFromDB();
    observerTweetList();
    await prepareFilterHtmlElm();
})

browser.runtime.onMessage.addListener((request: any, _sender: Runtime.MessageSender, sendResponse: (response?: any) => void): true => {
    return contentMsgDispatch(request, _sender, sendResponse)
});

function contentMsgDispatch(request: any, _sender: Runtime.MessageSender, sendResponse: (response?: any) => void):true {

    switch (request.action) {
        case MsgType.NaviUrlChanged:
            checkFilterBtn().then();
            sendResponse({success: true});
            break;
        default:
            sendResponse({success: true});
    }

    return true;
}
