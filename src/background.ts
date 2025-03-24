/// <reference lib="webworker" />
import browser, {Runtime, WebNavigation, WebRequest, windows} from "webextension-polyfill";
import {createAlarm} from "./bg_timer";
import {bgMsgDispatch} from "./bg_msg";
import {__targetUrlToFilter, _db_key_query_id_, DEFAULT_QUERY_ID, MsgType} from "./consts";
import {sessionGet, sessionSet} from "./session_storage";

self.addEventListener('activate', (event) => {
    console.log('------>>> Service Worker activating......');
    const extendableEvent = event as ExtendableEvent;
    extendableEvent.waitUntil((self as unknown as ServiceWorkerGlobalScope).clients.claim());
    extendableEvent.waitUntil(createAlarm());
});

self.addEventListener('install', (event) => {
    console.log('------>>> Service Worker installing......');
    const evt = event as ExtendableEvent;
    evt.waitUntil(createAlarm());
});

browser.runtime.onInstalled.addListener((details: Runtime.OnInstalledDetailsType) => {
    console.log("------>>> onInstalled......");
    sessionSet(_db_key_query_id_, DEFAULT_QUERY_ID).then();

    if (details.reason === "install") {
        browser.tabs.create({
            url: browser.runtime.getURL("html/welcome.html#onboarding/welcome")
        }).then(() => {
        });
    }
});

browser.runtime.onStartup.addListener(() => {
    console.log('------>>> onStartup......');
});

browser.runtime.onMessage.addListener((request: any, _sender: Runtime.MessageSender, sendResponse: (response?: any) => void): true => {
    return bgMsgDispatch(request, _sender, sendResponse)
});

async function handleNavigation(details: WebNavigation.OnCompletedDetailsType | WebNavigation.OnHistoryStateUpdatedDetailsType) {
    if (details.url === __targetUrlToFilter) {
        await browser.tabs.sendMessage(details.tabId, {action: MsgType.NaviUrlChanged});
    }
}

browser.webNavigation.onCompleted.addListener(handleNavigation, {url: [{urlMatches: 'https://x.com/*'}]});
browser.webNavigation.onHistoryStateUpdated.addListener(handleNavigation, {url: [{urlMatches: 'https://x.com/*'}]});
