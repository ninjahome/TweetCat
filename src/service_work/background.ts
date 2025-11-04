/// <reference lib="webworker" />
import browser, {Runtime} from "webextension-polyfill";
import {bgMsgDispatch} from "./bg_msg";
import {
    __DBK_query_id_map,
    defaultQueryKeyMap,
    MsgType,
    watchedOps
} from "../common/consts";
import {checkAndInitDatabase} from "../common/database";
import {localGet, localSet} from "../common/local_storage";
import {getBearerToken, updateBearerToken} from "../common/utils";
import {createAlarm, updateAlarm} from "./bg_timer";
import {resetApiBucketSetting} from "./api_bucket_state";

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
    console.log("------>>> onInstalled reason:", details.reason);
    if (details.reason === "install") {
        browser.tabs.create({
            url: browser.runtime.getURL("html/welcome.html")
        }).then();
        createAlarm().then();
    } else if (details.reason === "update") {
        updateAlarm().then();
    }
    resetApiBucketSetting().then(() => {
        console.log("------>>> update api bucket settings")
    });
    initDefaultQueryKey().then();
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


let lastDetails: any = null;
let lastTimeStamp = 0;

async function handleNavigation(details: any) {

    if (details.frameId !== 0) {
        console.log('Ignoring subframe navigation:', details.url);
        return;
    }

    // 拷贝一个对象用于比较，排除 timeStamp
    const {timeStamp, ...rest} = details;

    const sameContent = JSON.stringify(rest) === JSON.stringify(lastDetails)
    if (
        lastDetails && sameContent &&
        Math.abs(timeStamp - lastTimeStamp) < 500 // 阈值 500ms
    ) {
        console.log("⚠️ 忽略重复导航事件:", details.url);
        return;
    }

    // 更新 lastDetails
    lastDetails = rest;
    lastTimeStamp = timeStamp;

    try {
        await browser.tabs.sendMessage(details.tabId, {
            action: MsgType.NaviUrlChanged
        });
    } catch (e) {
        console.log("Navigation message error:", e);
    }
}

browser.webNavigation.onCompleted.addListener(handleNavigation, {
    url: [
        {hostSuffix: 'youtube.com', schemes: ['https']},
        {hostSuffix: 'x.com', schemes: ['https']}
    ]
});

browser.webNavigation.onHistoryStateUpdated.addListener(handleNavigation, {
    url: [
        {hostSuffix: 'youtube.com', schemes: ['https']},
        {hostSuffix: 'x.com', schemes: ['https']}
    ]
});

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
