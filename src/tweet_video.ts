import {TweetMediaEntity} from "./object_tweet";
import Hls from 'hls.js';

const videoControllers = new WeakMap<HTMLVideoElement, { observer: IntersectionObserver }>();
let currentPlaying: HTMLVideoElement | null = null;

class HlsManager {
    private hls: Hls;
    private currentVideo: HTMLVideoElement | null = null;

    constructor() {
        this.hls = new Hls({
        });
    }

    async play(video: HTMLVideoElement, src: string) {
        if (this.currentVideo === video) return;
        this.hls.detachMedia();
        this.hls.loadSource(src);
        this.hls.attachMedia(video);
        this.currentVideo = video;
    }

    pause(video: HTMLVideoElement) {
        if (this.currentVideo === video) {
            video.pause();
            this.hls.detachMedia();
            this.currentVideo = null;
        }
    }

    destroy() {
        this.hls.destroy();
    }
}

const globalHlsManager = new HlsManager();

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

function setupTwitterStyleVideo(video: HTMLVideoElement, hlsSource?: string, mp4?: {
    url: string;
    content_type: string
}, durationMillis?: number, badge?: HTMLElement | null) {
    video.preload = 'metadata';
    video.muted = true;
    video.autoplay = false;
    video.playsInline = true;
    video.controls = true;

    if (hlsSource && Hls.isSupported()) {
        globalHlsManager.play(video, hlsSource)
    } else if (hlsSource && video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = hlsSource;
        video.load();
    } else if (mp4) {
        const src = document.createElement("source");
        src.src = mp4.url;
        src.type = mp4.content_type;
        video.appendChild(src);
    }

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const targetVideo = entry.target as HTMLVideoElement;
            if (entry.isIntersecting) {
                if (hlsSource && Hls.isSupported()) {
                    globalHlsManager.play(targetVideo, hlsSource);
                }
                if (currentPlaying && currentPlaying !== targetVideo) {
                    currentPlaying.pause();
                }
                targetVideo.play().catch(() => {
                });
                currentPlaying = targetVideo;
            } else {
                if (targetVideo !== currentPlaying) {
                    targetVideo.pause();
                } else if (hlsSource && Hls.isSupported()) {
                    globalHlsManager.pause(targetVideo);
                }
            }
        });
    }, {threshold: 0.5});

    observer.observe(video);
    videoControllers.set(video, {observer});

    if (badge && durationMillis != null) {
        const totalSeconds = Math.floor(durationMillis / 1000);
        badge.textContent = msToClock(durationMillis);
        updateDurationBadge(video, badge, totalSeconds);
    } else if (badge) {
        badge.remove();
    }
}

export function videoRender(m: TweetMediaEntity, tpl: HTMLTemplateElement): HTMLElement {
    const wrapper = tpl.content
        .getElementById('media-video-template')!
        .cloneNode(true) as HTMLElement;

    wrapper.removeAttribute('id');

    const video = wrapper.querySelector('video') as HTMLVideoElement;
    video.poster = m.media_url_https || '';

    const hlsSource = m.video_info?.variants.find(v => v.content_type === "application/x-mpegURL")?.url;
    const mp4 = pickBestMp4(m);
    const badge = wrapper.querySelector('.duration-badge') as HTMLElement | null;

    setupTwitterStyleVideo(video, hlsSource, mp4, m.video_info?.duration_millis, badge);

    return wrapper;
}

export function cleanupVideo(video: HTMLVideoElement) {
    const controller = videoControllers.get(video);
    if (!controller) return;
    controller.observer.disconnect();
    videoControllers.delete(video);
}

function pickBestMp4(m: TweetMediaEntity) {
    return m.video_info?.variants
        ?.filter(v => v.content_type === 'video/mp4')
        .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];
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
