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

browser.webRequest.onBeforeRequest.addListener(
    (details) => {
        parseKolInfo(details.tabId, new URL(details.url)).then();
    },
    {urls: ["https://twitter.com/i/api/graphql/*", "https://x.com/i/api/graphql/*"]},
    ["requestBody"]
);

function urlParseQuery(search: string): URLSearchParams {
    return new URLSearchParams(search);
}

function urlDecodeQuery(str: string): string {
    return decodeURIComponent(str);
}

async function parseKolInfo(tabId: number, url: URL) {

    const queryMatch = url.pathname.match(/\/graphql\/([a-zA-Z0-9_-]+)\/UserTweets/);
    if (!queryMatch || tabId <= 0) return;
    const tab = await browser.tabs.get(tabId);
    if (!tab.url) return;

    const twitterQueryId = await sessionGet(_db_key_query_id_);
    const queryId = queryMatch[1];
    if (queryId !== twitterQueryId) {
        sessionSet(_db_key_query_id_, queryId).then();
    }

    const variablesMatch = urlDecodeQuery(urlParseQuery(url.search).get('variables') || '');
    const variables = JSON.parse(variablesMatch);
    const userId = variables.userId;

    console.log("-------->>>>>已成功捕获并存储queryId:", queryId, " user id:", userId);
    const match = tab.url.match(/https:\/\/x\.com\/([^\/]+)/);
    if (match) {
        const username = match[1];
        console.log("------<<>>>通过background捕获referer username:", username);
    }

}

