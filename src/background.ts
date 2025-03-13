/// <reference lib="webworker" />
import browser, {Runtime, WebNavigation} from "webextension-polyfill";
import {createAlarm} from "./bg_timer";
import {bgMsgDispatch} from "./bg_msg";
import { __targetUrlToFilter} from "./consts";
import {sessionSet} from "./session_storage";

const runtime = browser.runtime;
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

runtime.onInstalled.addListener((details: Runtime.OnInstalledDetailsType) => {
    console.log("------>>> onInstalled......");
    if (details.reason === "install") {
        browser.tabs.create({
            url: runtime.getURL("html/welcome.html#onboarding/welcome")
        }).then(() => {
        });
    }
});

runtime.onStartup.addListener(() => {
    console.log('------>>> onStartup......');
});

browser.runtime.onMessage.addListener((request: any, _sender: Runtime.MessageSender, sendResponse: (response?: any) => void): true => {
    return bgMsgDispatch(request, _sender, sendResponse)
});

// async function handleNavigation(details: WebNavigation.OnCompletedDetailsType | WebNavigation.OnHistoryStateUpdatedDetailsType) {
//     await browser.tabs.sendMessage(details.tabId, { action: 'filterContent' });
//     if (details.url === __targetUrlToFilter) {
//         console.log("======>>> current tab is ok")
//         await sessionSet(__CK_is_target, true)
//     } else {
//         console.log("======>>> current tab not active")
//     }
// }
//
// browser.webNavigation.onCompleted.addListener(handleNavigation, {url: [{urlMatches: 'https://x.com/*'}]});
// browser.webNavigation.onHistoryStateUpdated.addListener(handleNavigation, {url: [{urlMatches: 'https://x.com/*'}]});