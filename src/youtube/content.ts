import browser, {Runtime} from "webextension-polyfill";
import {observeSimple, sendMsgToService} from "../common/utils";
import {MsgType} from "../common/consts";
import {isTcMessage, TcMessage} from "../common/msg_obj";
import {YTParsedLite} from "./video_obj";

(function injectPageScript() {
    try {
        const script = document.createElement('script');
        script.src = browser.runtime.getURL('js/yt_inject.js'); // 对应 webpack entry: yt_inject
        script.async = false;
        (document.head || document.documentElement).appendChild(script);
        script.onload = () => script.remove();
    } catch (e) {
        console.warn('[TweetCat] inject failed:', e);
    }
})();

document.addEventListener('DOMContentLoaded', onDocumentLoaded);

async function onDocumentLoaded() {
    // const vid = isWatchingPage();
    // if (vid) checkIfVideoLoaded(vid);
}

let videoObserver: MutationObserver | null = null;

function stopVideoObserver() {
    if (videoObserver) {
        try {
            videoObserver.disconnect();
        } catch {
        }
        videoObserver = null;
    }
}

function checkIfVideoLoaded(videoID: string) {
    stopVideoObserver();

    const root =
        document.getElementById('primary') ??
        document.body ??
        document.documentElement;

    const judgeFunc = (_mutations: MutationRecord[]) =>
     document.getElementById("below") as HTMLElement | null;;
        // document.querySelector('video.video-stream.html5-main-video') as HTMLElement | null;

    const onFound = (belowArea: HTMLElement) => {
        // ✅ 去掉 postWindowMsg
        console.log("------------------>>> video element found:", videoID);

        // ✅ 创建按钮并添加到视频下面
        const btn = document.createElement("button");
        btn.textContent = "下载视频";
        btn.style.backgroundColor = "red";
        btn.style.color = "white";
        btn.style.fontSize = "20px";
        btn.style.padding = "10px 20px";
        btn.style.marginTop = "10px";
        btn.style.border = "none";
        btn.style.cursor = "pointer";
        btn.style.display = "block";

        btn.addEventListener("click", async () => {
            console.log("下载按钮被点击，videoID=", videoID);
            await sendMsgToService(videoID, MsgType.YTVideoSave);
        });

        belowArea.parentElement.insertBefore(btn, belowArea);
        videoObserver = null;
        return true;
    };

    videoObserver = observeSimple(root as HTMLElement, judgeFunc, onFound);
}

function parseVideoParam(videoInfo: YTParsedLite) {
    console.log(videoInfo)
}


function isWatchingPage(): string | null {
    try {
        const {hostname, pathname, search} = window.location;
        const isYouTube = hostname === 'youtube.com' || hostname.endsWith('.youtube.com');
        if (!isYouTube) return null;
        if (pathname !== '/watch') return null;

        const params = new URLSearchParams(search);
        const v = params.get('v');
        if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;
        return null;
    } catch {
        return null;
    }
}

browser.runtime.onMessage.addListener((request: any, _sender: Runtime.MessageSender, sendResponse: (response?: any) => void): true => {
    return contentMsgDispatch(request, _sender, sendResponse)
});

window.addEventListener('message', (e) => {
    if (e.source !== window || e.origin !== window.location.origin) return;

    const msg = e.data as TcMessage;
    if (!isTcMessage(msg)) return;
    switch (msg.action) {
        case MsgType.YTVideoParamGot: {
            parseVideoParam(msg.data as YTParsedLite);
            break;
        }
    }
});

function contentMsgDispatch(request: any, _sender: Runtime.MessageSender, sendResponse: (response?: any) => void): true {

    switch (request.action) {
        case MsgType.NaviUrlChanged: {
            console.log("-------->>> url changed:", window.location);
            const videoID = isWatchingPage()
            if (videoID) checkIfVideoLoaded(videoID);
            sendResponse({success: true});
            break;
        }
    }

    return true;
}
