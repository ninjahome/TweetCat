import {TweetMediaEntity} from "./object_tweet";
import Hls from 'hls.js';

const videoControllers = new WeakMap<HTMLVideoElement, {
    observer: IntersectionObserver,
    hls: Hls | null,
    hasStarted: boolean
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

function setupTwitterStyleVideo(
    video: HTMLVideoElement,
    hlsSource?: string,
    mp4Variants?: { url: string; content_type: string; bitrate?: number }[],
    durationMillis?: number,
    badge?: HTMLElement | null
) {
    video.preload = 'none'; // 懒加载
    video.muted = true;
    video.playsInline = true;
    video.controls = true;

    let hls: Hls | null = null;
    let hasStarted = false;

    video.addEventListener('click', () => {
        if (video.paused) {
            video.play().catch(() => {
            });
        } else {
            video.pause();
        }
    });

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const targetVideo = entry.target as HTMLVideoElement;
            const controller = videoControllers.get(targetVideo);

            if (entry.isIntersecting) {
                // 首次进入视图才开始加载并播放
                if (controller && !controller.hasStarted) {
                    if (hlsSource && Hls.isSupported()) {
                        hls = new Hls({
                            maxMaxBufferLength: 60,
                            backBufferLength: 90,
                            enableWorker: true,
                            lowLatencyMode: true
                        });
                        hls.loadSource(hlsSource);
                        hls.attachMedia(targetVideo);
                        controller.hls = hls;
                    } else if (hlsSource && targetVideo.canPlayType("application/vnd.apple.mpegurl")) {
                        targetVideo.src = hlsSource;
                    } else if (mp4Variants && mp4Variants.length > 0) {
                        mp4Variants
                            .filter(v => v.content_type === 'video/mp4')
                            .forEach(variant => {
                                const src = document.createElement("source");
                                src.src = variant.url;
                                src.type = variant.content_type;
                                targetVideo.appendChild(src);
                            });
                    }
                    targetVideo.load();
                    controller.hasStarted = true;
                }

                if (currentPlaying && currentPlaying !== targetVideo) {
                    currentPlaying.pause();
                }
                targetVideo.play().catch(() => {
                });
                currentPlaying = targetVideo;
            } else {
                targetVideo.pause();

                if (controller?.hls) {
                    controller.hls.destroy();
                    controller.hls = null;
                    controller.hasStarted = false;
                    targetVideo.innerHTML = '';
                }
            }
        });
    }, {threshold: 0.75});

    observer.observe(video);
    videoControllers.set(video, {observer, hls, hasStarted});

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
    const mp4Variants = m.video_info?.variants.filter(v => v.content_type === 'video/mp4');
    const badge = wrapper.querySelector('.duration-badge') as HTMLElement | null;

    setupTwitterStyleVideo(video, hlsSource, mp4Variants, m.video_info?.duration_millis, badge);

    return wrapper;
}

export function cleanupVideo(video: HTMLVideoElement) {
    const controller = videoControllers.get(video);
    if (!controller) return;
    controller.observer.disconnect();
    controller.hls?.destroy();
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