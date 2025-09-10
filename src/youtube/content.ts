import browser, {Runtime} from "webextension-polyfill";
import {observeSimple, sendMsgToService} from "../common/utils";
import {MsgType} from "../common/consts";
import {isTcMessage, TcMessage} from "../common/msg_obj";
import {YTParsedLite} from "./video_obj";
import {VideoMeta, YouTubePageType} from "../object/video_meta";

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
        document.getElementById("below") as HTMLElement | null;
    // document.querySelector('video.video-stream.html5-main-video') as HTMLElement | null;

    const onFound = () => {
        // ✅ 去掉 postWindowMsg
        console.log("------------------>>> video element found:", videoID);
        const info = extractYTInfo(videoID);
        if (!info) return;

        console.log("--------video infos:", info);

        sendMsgToService(info, MsgType.YTVideoMetaGot).then();
        videoObserver = null;
        return true;
    };

    videoObserver = observeSimple(root as HTMLElement, judgeFunc, onFound);
}

let latestVideoID = ""

function checkIfShortsLoaded(videoID: string) {
    if (latestVideoID === videoID) return;
    latestVideoID = videoID;
    console.log("------------>>>checkIfShortsLoaded: ", videoID);

    const shortsInfo = extractYTShortsInfo(videoID);
    if (!shortsInfo) {
        setTimeout(() => {
            const tryAgainInfo = extractYTShortsInfo(videoID);
            console.log("--------try again infos:", tryAgainInfo);
            if (!tryAgainInfo) return;
            sendMsgToService(tryAgainInfo, MsgType.YTVideoMetaGot).then();
        }, 500);
        return
    }
    console.log("--------shorts infos:", shortsInfo);
    sendMsgToService(shortsInfo, MsgType.YTVideoMetaGot).then();
}

function parseVideoParam(videoInfo: YTParsedLite) {
    console.log(videoInfo)
}

export function isWatchingPage(): { videoId: string; type: YouTubePageType } | null {
    try {
        const u = new URL(window.location.href);

        // 只处理 youtube.com
        if (u.hostname !== "www.youtube.com" && u.hostname !== "youtube.com") {
            return null;
        }

        // watch 模式
        if (u.pathname === "/watch") {
            const videoId = u.searchParams.get("v");
            if (videoId) {
                return {videoId, type: YouTubePageType.Watch};
            }
        }

        // shorts 模式
        if (u.pathname.startsWith("/shorts/")) {
            const videoId = u.pathname.split("/")[2];
            if (videoId) {
                return {videoId, type: YouTubePageType.Shorts};
            }
        }

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
        case MsgType.IJYTVideoParamGot: {
            parseVideoParam(msg.data as YTParsedLite);
            break;
        }
    }
});

function contentMsgDispatch(request: any, _sender: Runtime.MessageSender, sendResponse: (response?: any) => void): true {

    switch (request.action) {
        case MsgType.NaviUrlChanged: {
            console.log("-------->>> url changed:", window.location);
            const videoInfo = isWatchingPage()
            if (videoInfo) {
                if (videoInfo.type === YouTubePageType.Watch) checkIfVideoLoaded(videoInfo.videoId);
                else checkIfShortsLoaded(videoInfo.videoId);
            }
            sendResponse({success: true});
            break;
        }
    }

    return true;
}


export function extractYTInfo(videoID: string): VideoMeta | null {
    try {
        const html = document.documentElement.innerHTML;
        // 非贪婪匹配，只抓 ytInitialPlayerResponse 对象
        const match = html.match(/ytInitialPlayerResponse\s*=\s*(\{.*?\})\s*;/s);
        if (!match) return null;

        const data = JSON.parse(match[1]);

        const title = data?.videoDetails?.title ?? "";
        const duration = parseInt(data?.videoDetails?.lengthSeconds ?? "0", 10);
        const thumbs = data?.videoDetails?.thumbnail?.thumbnails ?? [];

        if (!title || !duration || !Array.isArray(thumbs)) {
            return null;
        }

        const videoTyp = YouTubePageType.Watch;
        return {videoID, videoTyp, title, duration, thumbs};
    } catch (err) {
        console.error("[TweetCat] extractYTInfo failed:", err);
        return null;
    }
}


function extractYTShortsInfo(videoID: string): VideoMeta | null {
    // 1) 用 videoID 拼 href，并用 closest() 锁定当前 shorts 的基本单元 container
    const hrefPart = `/shorts/${videoID}`;
    const anchor =
        document.querySelector<HTMLAnchorElement>(`a[href$="${hrefPart}"], a[href*="${hrefPart}?"]`);
    const container = anchor?.closest<HTMLDivElement>(
        'div.reel-video-in-sequence-new.style-scope.ytd-shorts'
    );
    if (!container) return null;

    // 2) 在 container 内获取“当前视频”的标题
    // 优先：player 顶部条里的标题链接（必须匹配当前 videoID，避免串台）
    let title =
        container.querySelector<HTMLAnchorElement>(
            `.ytp-title .ytp-title-link[href*="${hrefPart}"]`
        )?.textContent?.trim() || '';

    // 回退：overlay 面板里的 h2（真正的当条标题）
    if (!title) {
        title =
            container.querySelector<HTMLHeadingElement>(
                'yt-shorts-video-title-view-model h2'
            )?.textContent?.trim() || '';
    }

    // 绝不从以下节点取文本：会指向“下一条”，导致你遇到的偏移
    // container.querySelector('yt-reel-multi-format-link-view-model h3')

    // 3) 缩略图（你这边已正确获取，这里保留）
    const thumbs: VideoMeta['thumbs'] = [];
    const thumbDiv = container.querySelector<HTMLDivElement>('.reel-video-in-sequence-thumbnail');
    if (thumbDiv) {
        const bg =
            getComputedStyle(thumbDiv).getPropertyValue('background-image') ||
            thumbDiv.style.backgroundImage;
        const m = bg && bg.match(/url\(["']?(.*?)["']?\)/);
        if (m && m[1]) {
            thumbs.push({url: m[1], width: 0, height: 0});
        }
    }

    return {
        videoID,
        videoTyp: YouTubePageType.Shorts,
        title,
        duration: 0,
        thumbs,
    };
}


