import {TweetMediaEntity} from "./object_tweet";
import Hls from 'hls.js';

const videoControllers = new WeakMap<HTMLVideoElement, {
    observer: IntersectionObserver,
    hls: Hls | null,
    hasStarted: boolean,
    lastTime: number
}>();
let currentPlaying: HTMLVideoElement | null = null;

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

function attachVideoSources(video: HTMLVideoElement, hlsSource?: string, mp4Variants?: {
    url: string;
    content_type: string;
    bitrate?: number
}[]): Hls | null {
    let hls: Hls | null = null;
    if (hlsSource && Hls.isSupported()) {
        hls = new Hls({
            enableWorker: true,
            lowLatencyMode: true,
            backBufferLength: 30,
            maxBufferLength: 20,
            maxMaxBufferLength: 30,
            maxBufferSize: 10 * 1024 * 1024,
            maxBufferHole: 0.5,
            startPosition: -1
        });
        hls.loadSource(hlsSource);
        hls.attachMedia(video);
    } else if (hlsSource && video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = hlsSource;
    } else if (mp4Variants && mp4Variants.length > 0 && video.children.length === 0) {
        mp4Variants
            .filter(v => v.content_type === 'video/mp4')
            .forEach(variant => {
                const src = document.createElement("source");
                src.src = variant.url;
                src.type = variant.content_type;
                video.appendChild(src);
            });
    }
    return hls;
}


function handleIntersection(entries: IntersectionObserverEntry[], hlsSource?: string, mp4Variants?: {
    url: string;
    content_type: string;
    bitrate?: number
}[]) {
    if (entries.length === 0 || entries.length > 2) return;
    const entry = entries[0];

    const targetVideo = entry.target as HTMLVideoElement;
    const controller = videoControllers.get(targetVideo);

    if (!controller) return;

    if (entry.isIntersecting) {
        if (!controller.hasStarted) {
            const hls = attachVideoSources(targetVideo, hlsSource, mp4Variants);
            controller.hls = hls;
            controller.hasStarted = true;
        }

        if (currentPlaying && currentPlaying !== targetVideo) {
            currentPlaying.pause();
        }

        controller.hls?.startLoad();
        targetVideo.play().catch(() => {
        });

        if (currentPlaying && currentPlaying !== targetVideo) {
            currentPlaying.pause();
        }
        targetVideo.play().catch(() => {
        });

        currentPlaying = targetVideo;
    } else {
        targetVideo.pause();
        // 不销毁 hls，但暂停加载视频数据以减少资源浪费
        controller.hls?.stopLoad();
    }
}

function setupTwitterStyleVideo(
    video: HTMLVideoElement,
    hlsSource?: string,
    mp4Variants?: { url: string; content_type: string; bitrate?: number }[],
    durationMillis?: number,
    badge?: HTMLElement | null
) {
    video.preload = 'none';
    video.muted = true;
    video.playsInline = true;
    video.controls = true;

    const observer = new IntersectionObserver((entries) => {
        handleIntersection(entries, hlsSource, mp4Variants);
    }, {threshold: 0.6});

    observer.observe(video);
    videoControllers.set(video, {observer, hls: null, hasStarted: false, lastTime: 0});

    if (badge && durationMillis != null) {
        const totalSeconds = Math.floor(durationMillis / 1000);
        badge.textContent = msToClock(durationMillis);
        updateDurationBadge(video, badge, totalSeconds);
    } else if (badge) {
        badge.remove();
    }
}

export function cleanupVideo(video: HTMLVideoElement) {
    const controller = videoControllers.get(video);
    if (!controller) return;

    controller.observer.disconnect();

    video.pause();
    controller.hls?.destroy();

    video.removeAttribute('src');
    video.innerHTML = '';

    videoControllers.delete(video);
}

function msToClock(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const pad = (n: number) => n.toString().padStart(2, '0');

    return hours > 0
        ? `${hours}:${pad(minutes)}:${pad(seconds)}`
        : `${minutes}:${pad(seconds)}`;
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

    // MP4 fallback
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
    video.play().catch(err => {
        console.warn("MP4 autoplay failed:", err);
    });
}
