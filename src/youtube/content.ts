import browser from "webextension-polyfill";

function mountInjection() {
    const YT_INJECT_PATH = 'yt-inject-patch';
    if (document.getElementById(YT_INJECT_PATH)) return;

    const url = browser.runtime.getURL('js/yt_inject.js');
    const s = document.createElement('script');
    s.id = YT_INJECT_PATH;
    s.src = url;
    s.onload = () => s.remove();      // 注入后自删
    document.documentElement.appendChild(s);
}

mountInjection();

export type Stream = {
    itag: string;
    mimeType: string;
    url: string;
    width?: number;
    height?: number;
    fps?: number;
    bitrate?: number;
    audioQuality?: string;
    approxDurationMs?: string;
};

export function refreshYoutubeUI(streams: Stream[]) {
}

document.addEventListener('DOMContentLoaded', onDocumentLoaded);

async function onDocumentLoaded() {
}