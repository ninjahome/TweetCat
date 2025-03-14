import browser, {Runtime} from "webextension-polyfill";
import {observerTweetList} from "./content_oberver";
import {checkFilterBtn, prepareFilterHtmlElm} from "./content_filter";
import {loadCategoriesFromDB} from "./content_category";
import {MsgType} from "./consts";

document.addEventListener('DOMContentLoaded', async () => {
    console.log('------>>>TweetCat content script success ✨')
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
            checkFilterBtn();
            sendResponse({success: true});
            break;
        default:
            sendResponse({success: true});
    }

    return true;
}
