/// <reference lib="webworker" />
import browser, {Runtime, WebNavigation} from "webextension-polyfill";
import {bgMsgDispatch} from "./bg_msg";
import {__DBK_Bearer_Token, __DBK_query_id_map, __targetUrlToFilter, MsgType} from "./consts";
import {checkAndInitDatabase} from "./database";
import {localGet, localSet} from "./local_storage";
import {getBearerToken} from "./utils";

self.addEventListener('activate', (event) => {
    console.log('------>>> Service Worker activating......');
    const extendableEvent = event as ExtendableEvent;
    extendableEvent.waitUntil((self as unknown as ServiceWorkerGlobalScope).clients.claim());
    // extendableEvent.waitUntil(createAlarm());
});

self.addEventListener('install', () => {
    console.log('------>>> Service Worker installing......');
    // const evt = event as ExtendableEvent;
    // evt.waitUntil(createAlarm());
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
    checkAndInitDatabase().then();
});

browser.runtime.onMessage.addListener((request: any, _sender: Runtime.MessageSender, sendResponse: (response?: any) => void): true => {
    (async () => {
        await checkAndInitDatabase();
        const result = await bgMsgDispatch(request, _sender);
        sendResponse(result);
    })();
    return true;
});

async function handleNavigation(details: WebNavigation.OnCompletedDetailsType | WebNavigation.OnHistoryStateUpdatedDetailsType) {
    try {
        await browser.tabs.sendMessage(details.tabId, {
            action: MsgType.NaviUrlChanged,
            isHome: details.url === __targetUrlToFilter
        });
    } catch (e) {
        console.log("------>>> navigation message error:", e);
    }
}

browser.webNavigation.onCompleted.addListener(handleNavigation, {url: [{urlMatches: 'https://x.com/*'}]});
browser.webNavigation.onHistoryStateUpdated.addListener(handleNavigation, {url: [{urlMatches: 'https://x.com/*'}]});

browser.webRequest.onBeforeSendHeaders.addListener(
    async (details) => {
        const headers = details.requestHeaders || [];
        const authHeader = headers.find(h => h.name.toLowerCase() === 'authorization');
        const origToken = await getBearerToken();
        if (authHeader && authHeader.value?.startsWith('Bearer ')) {
            const token = authHeader.value;
            if (origToken !== token) {
                await localSet(__DBK_Bearer_Token, token);
                console.log("------------------>>>temp ===>>🪪 Detected Bearer Token:", token);
            }
        }
        return {requestHeaders: headers};
    },
    {urls: ["https://x.com/i/api/graphql/*"]},
    ["requestHeaders"]
);


browser.webRequest.onBeforeRequest.addListener(
    (details) => {
        const url = new URL(details.url);
        const match = url.pathname.match(/^\/i\/api\/graphql\/([^/]+)\/([^/]+)/);

        if (!match) return;
        const queryId = match[1];
        const operationName = match[2];
        // console.log(`------>>>[GraphQL QueryId Update] ${operationName} → ${queryId}`);
        localGet(__DBK_query_id_map).then(data => {
            const existingMap: Record<string, string> = data as Record<string, string> || {}
            if (!existingMap[operationName] || existingMap[operationName] !== queryId) {
                existingMap[operationName] = queryId;
                localSet(__DBK_query_id_map, existingMap).then();
                console.log(`------>>>[GraphQL QueryId Update] ${operationName} → ${queryId}`);
            }
        });
    },
    {
        urls: ["https://x.com/i/api/graphql/*"],
        types: ["xmlhttprequest"],
    }
);