import {TweetMediaEntity} from "./object_tweet";
import Hls from 'hls.js';

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

    const bestVariant = selectBestVideoVariant(m.video_info?.variants ?? []);
    if (bestVariant) {
        console.log("Selected best video:", bestVariant);
        safeSetVideoSource(video, bestVariant.url, bestVariant.content_type);
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

    return selected ? {url: selected.url, content_type: selected.content_type} : null;
}


function safeSetVideoSource(video: HTMLVideoElement, url: string, type: string) {
    if (type === 'application/x-mpegURL' && typeof Hls !== 'undefined' && Hls.isSupported()) {
        const hls = new Hls();
        hls.loadSource(url);
        hls.attachMedia(video);

        video.muted = true;
        video.autoplay = true;
        video.controls = true;
        video.playsInline = true;

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
            video.play().catch(err => {
                console.warn("HLS autoplay failed:", err);
            });
        });

        return;
    }

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
    video.play().catch(err => {
        console.warn("MP4 autoplay failed:", err);
    });
}
