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
    watchMicroformat();
}


function watchMicroformat() {

    const root =
        document.getElementById('primary') ??
        document.body ??
        document.documentElement;

    const judgeFunc = (_mutations: MutationRecord[]) =>
        document.getElementById("microformat") as HTMLElement | null;

    const onFound = (mDiv) => {
        observeSimple(mDiv, () => {
            return document.querySelector("player-microformat-renderer") as HTMLElement
        }, (pmr) => {

            const {videoId} = isWatchingPage();
            console.log("------------------>>> video element found:", videoId);
            const info = extractYTInfo(videoId, pmr);
            if (!info) return;

            console.log("--------video infos:", info);

            sendMsgToService(info, MsgType.YTVideoMetaGot).then();
            return false;
        })

        return true;
    };

    observeSimple(root as HTMLElement, judgeFunc, onFound);
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
            if (videoInfo && videoInfo.type === YouTubePageType.Shorts) {
                checkIfShortsLoaded(videoInfo.videoId);
            }
            sendResponse({success: true});
            break;

        }
    }

    return true;
}

export function extractYTInfo(videoID: string, microElem: Element | null): VideoMeta | null {
    try {
        if (!microElem) return null;

        const raw = microElem.textContent;
        if (!raw) return null;

        const data = JSON.parse(raw);

        const title = data?.name ?? "";
        const durationStr = data?.duration ?? ""; // e.g. "PT181S"
        const duration = (() => {
            const m = durationStr.match(/^PT(\d+)S$/);
            return m ? parseInt(m[1], 10) : 0;
        })();

        const thumbs: Array<{ url: string; width: number; height: number }> = [];
        if (Array.isArray(data?.thumbnailUrl)) {
            for (const url of data.thumbnailUrl) {
                thumbs.push({url, width: 0, height: 0}); // schema.org 里没写宽高
            }
        } else if (typeof data?.thumbnailUrl === "string") {
            thumbs.push({url: data.thumbnailUrl, width: 0, height: 0});
        }

        if (!title || !duration || thumbs.length === 0) {
            return null;
        }

        return {
            videoID,
            videoTyp: YouTubePageType.Watch,
            title,
            duration,
            thumbs,
        };
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
        thumbs: [
            {
                url: `https://i.ytimg.com/vi/${videoID}/hqdefault.jpg`,
                width: 0,
                height: 0,
            },
        ],
    };
}


