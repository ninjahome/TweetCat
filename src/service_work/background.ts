/// <reference lib="webworker" />
import browser, {Runtime, WebNavigation} from "webextension-polyfill";
import {bgMsgDispatch} from "./bg_msg";
import {
    __DBK_query_id_map,
    __targetUrlToFilter,
    defaultQueryKeyMap,
    MsgType,
    watchedOps
} from "../common/consts";
import {checkAndInitDatabase} from "../common/database";
import {localGet, localSet} from "../common/local_storage";
import {getBearerToken, updateBearerToken} from "../common/utils";
import {createAlarm} from "./bg_timer";

/****************************************************************************************
 ┌────────────┐
 │ install    │─────────────┐
 └────────────┘             ▼
 ┌────────────┐
 │ activate   │──► claim() + createAlarm()
 └────────────┘
 ▼
 ┌────────────┐
 │ onInstalled│──► 初始化配置、DB、alarm
 └────────────┘
 ▼
 ┌────────────┐
 │ onStartup  │──► 检查 DB、alarm
 └────────────┘
 ▼
 ┌────────────┐
 │ onMessage  │──► 动态调度 + alarm fallback
 └────────────┘

 ***************************************************************************************/

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
            url: browser.runtime.getURL("html/welcome.html")
        }).then();
    }
    (async () => {
        await checkAndInitDatabase();
        await initDefaultQueryKey();
        await createAlarm();
    })();
});


async function initDefaultQueryKey() {
    let existMap = await localGet(__DBK_query_id_map);

    // 不存在，直接存
    if (!existMap || typeof existMap !== "object") {
        await localSet(__DBK_query_id_map, defaultQueryKeyMap);
        console.log("----->>> init default query key map success! (full set)");
        return;
    }

    // 部分 key 缺失，用默认值补全
    let needUpdate = false;
    for (const key of Object.keys(defaultQueryKeyMap)) {
        if (!(key in existMap)) {
            existMap[key] = defaultQueryKeyMap[key];
            needUpdate = true;
        }
    }

    if (needUpdate) {
        await localSet(__DBK_query_id_map, existMap);
        console.log("----->>> init default query key map success! (partial update)");
    } else {
        console.log("----->>> init default query key map: already up to date");
    }
}


browser.runtime.onStartup.addListener(() => {
    (async () => {
        console.log('------>>> onStartup......');
        await checkAndInitDatabase();
        await createAlarm();
    })();
});

browser.runtime.onMessage.addListener((request: any, _sender: Runtime.MessageSender, sendResponse: (response?: any) => void): true => {
    (async () => {
        await checkAndInitDatabase();
        await createAlarm(); // 保底恢复定时器
        try {
            const result = await bgMsgDispatch(request, _sender);
            sendResponse(result);
        } catch (e) {
            sendResponse({success: false, data: e});
        }
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
        // console.log("------>>> navigation message error:", e);
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
                await updateBearerToken(token);
                console.log("------>>>Update Bearer Token:", token);
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

        if (!watchedOps.includes(operationName)) {
            return;
        }
        // console.log(`------>>>[GraphQL QueryId:] ${operationName} → ${queryId}`);
        localGet(__DBK_query_id_map).then(async data => {
            const existingMap: Record<string, string> = data as Record<string, string> || {}
            if (!existingMap[operationName] || existingMap[operationName] !== queryId) {
                existingMap[operationName] = queryId;
                await localSet(__DBK_query_id_map, existingMap).then();
                console.log(`------>>>[GraphQL QueryId Update] ${operationName} → ${queryId}`);
            }
        });
    },
    {
        urls: ["https://x.com/i/api/graphql/*"],
        types: ["xmlhttprequest"],
    }
);



