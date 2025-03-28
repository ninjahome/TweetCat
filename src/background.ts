/// <reference lib="webworker" />
import browser, {Runtime, WebNavigation} from "webextension-polyfill";
import {createAlarm} from "./bg_timer";
import {bgMsgDispatch} from "./bg_msg";
import {__targetUrlToFilter, MsgType} from "./consts";
import {checkAndInitDatabase} from "./database";

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
    if (details.reason === "install") {
        browser.tabs.create({
            url: browser.runtime.getURL("html/welcome.html#onboarding/welcome")
        }).then();
    }
    checkAndInitDatabase().then();
});

browser.runtime.onStartup.addListener(() => {
    console.log('------>>> onStartup......');
    checkAndInitDatabase().catch(() => {
    });
});

browser.runtime.onMessage.addListener((request: any, _sender: Runtime.MessageSender, sendResponse: (response?: any) => void): true => {
    checkAndInitDatabase().then(async () => {
        await bgMsgDispatch(request, _sender, sendResponse);
    })
    return true;
});

async function handleNavigation(details: WebNavigation.OnCompletedDetailsType | WebNavigation.OnHistoryStateUpdatedDetailsType) {
    await browser.tabs.sendMessage(details.tabId, {
        action: MsgType.NaviUrlChanged,
        isHome: details.url === __targetUrlToFilter
    });
}

browser.webNavigation.onCompleted.addListener(handleNavigation, {url: [{urlMatches: 'https://x.com/*'}]});
browser.webNavigation.onHistoryStateUpdated.addListener(handleNavigation, {url: [{urlMatches: 'https://x.com/*'}]});
