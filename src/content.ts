import browser, {Runtime} from "webextension-polyfill";
import {observerTweetList} from "./content_oberver";
import {prepareFilterHtmlElm} from "./content_filter";
import {loadCategoriesFromDB} from "./content_category";

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
    return true;
}
