import {TweetMediaEntity} from "./tweet_entry";
import Hls from 'hls.js';
import {DBG, logTVR} from "../common/debug_flags";

function updateDurationBadge(video: HTMLVideoElement, badge: HTMLElement, totalSeconds: number) {
    let lastShown = -1;

    video.addEventListener('timeupdate', () => {
        const remaining = Math.max(0, totalSeconds - Math.floor(video.currentTime));
        if (remaining === lastShown) return;
        lastShown = remaining;

        const min = Math.floor(remaining / 60);
        const sec = remaining % 60;
        badge.textContent = `${min}:${sec.toString().padStart(2, '0')}`;
    });
}

export function videoRender(m: TweetMediaEntity, tpl: HTMLTemplateElement): HTMLElement {
    const wrapper = tpl.content
        .getElementById('media-video-template')!
        .cloneNode(true) as HTMLElement;

    wrapper.removeAttribute('id');

    const video = wrapper.querySelector('video') as HTMLVideoElement;
    const badge = wrapper.querySelector('.duration-badge') as HTMLElement | null;

    const aspectRatio = m.video_info?.aspect_ratio;
    if (aspectRatio && aspectRatio.length === 2) {
        const [w, h] = aspectRatio;
        wrapper.style.aspectRatio = `${w} / ${h}`;
    }

    const bestVariant = selectBestVideoVariant(m.video_info?.variants ?? []);
    if (bestVariant) {
        safeSetVideoSource(video, bestVariant.url, bestVariant.content_type);
    }

    const dict = extractMp4DownloadInfo(m.video_info?.variants ?? []);
    if (Object.keys(dict).length > 0) {
        wrapper.dataset.mp4Dict = JSON.stringify(dict);
        logTVR('[download-dataset]', wrapper.dataset.mp4Dict);
    } else {
        delete wrapper.dataset.mp4Dict;
        logTVR('[download-dataset] no mp4 variants found.');
    }

    if (badge && m.video_info?.duration_millis) {
        const totalSeconds = Math.floor(m.video_info.duration_millis / 1000);
        updateDurationBadge(video, badge, totalSeconds);
    }
    return wrapper;
}

function selectBestVideoVariant(
    variants: {
        bitrate?: number;
        content_type: string;
        url: string;
    }[]
): { url: string; content_type: string } | null {
    const hls = variants.find(v => v.content_type === 'application/x-mpegURL');
    if (hls && typeof Hls !== 'undefined' && Hls.isSupported()) {
        logTVR('[select] choose HLS m3u8:', hls.url);
        return {url: hls.url, content_type: hls.content_type};
    }

    const sortedMp4 = variants
        .filter(v => v.content_type === 'video/mp4')
        .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));

    let downlink = 5;
    try {
        const nav = navigator as any;
        downlink = nav.connection?.downlink ?? 5;
    } catch {
    }

    const isSlow = downlink < 1.5;
    const selected = isSlow ? sortedMp4.at(-1) : sortedMp4[1] ?? sortedMp4[0];

    logTVR('[select] net=', {downlink, isSlow}, 'mp4.candidates=', sortedMp4.length, 'chosen=', selected?.url);
    return selected ? {url: selected.url, content_type: selected.content_type} : null;
}

function safeSetVideoSource(video: HTMLVideoElement, url: string, type: string) {
    if (type === 'application/x-mpegURL' && typeof Hls !== 'undefined' && Hls.isSupported()) {
        logTVR('[hls] attaching Hls to <video>', {url});
        const hls = new Hls({
            maxMaxBufferLength: 30,
            startLevel: 0,
            autoStartLoad: true,
        });
        hls.loadSource(url);
        hls.attachMedia(video);

        video.muted = true;
        video.autoplay = true;
        video.controls = true;
        video.playsInline = true;

        hls.on(Hls.Events.ERROR, (_evt, data) => {
            console.log('[hls] error:', data?.type, data?.details, data);
        });

        return;
    }

    logTVR('[mp4] setting <source>', {url, type});
    video.innerHTML = '';
    const source = document.createElement('source');
    source.src = url;
    source.type = type;

    video.appendChild(source);

    video.preload = 'metadata';
    video.autoplay = true;
    video.controls = true;
    video.muted = true;
    video.playsInline = true;

    video.load();
}

function extractMp4DownloadInfo(
    variants: { bitrate?: number; content_type: string; url: string; }[]
): Record<string, string> {
    const dict: Record<string, string> = {};
    variants
        .filter(v => v.content_type === 'video/mp4' && v.bitrate)
        .sort((a, b) => (a.bitrate ?? 0) - (b.bitrate ?? 0))
        .forEach(v => {
            dict[String(v.bitrate!)] = v.url;
        });
    return dict;
}