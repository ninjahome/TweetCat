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

    // ✅ 动态设置 aspect-ratio
    const aspectRatio = m.video_info?.aspect_ratio;
    if (aspectRatio && aspectRatio.length === 2) {
        const [w, h] = aspectRatio;
        wrapper.style.aspectRatio = `${w} / ${h}`;
    }

    const bestVariant = selectBestVideoVariant(m.video_info?.variants ?? []);
    if (bestVariant) {
        safeSetVideoSource(video, bestVariant.url, bestVariant.content_type);
    }

    // ✅ 设置倒计时徽章
    if (badge && m.video_info?.duration_millis) {
        const totalSeconds = Math.floor(m.video_info.duration_millis / 1000);
        updateDurationBadge(video, badge, totalSeconds);
    }

    // ✅ 懒加载逻辑：使用 IntersectionObserver 控制播放与暂停
    const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (entry.target !== wrapper) continue;
            if (entry.isIntersecting) {
                video.play().catch((err) => {
                    console.log("------>>> video play err:", err);
                });
            } else {
                video.pause();
            }
        }
    }, {
        threshold: 0.75
    });

    observer.observe(wrapper);

    // ✅ 清理逻辑：当视频被移除时取消 observer
    const cleanupObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            mutation.removedNodes.forEach(node => {
                if (node === wrapper || (node instanceof Element && node.contains(wrapper))) {
                    observer.unobserve(wrapper);
                    cleanupObserver.disconnect();
                }
            });
        }
    });

    cleanupObserver.observe(document.body, {childList: true, subtree: true});

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

        // const onCanPlay = () => {
        //     video.removeEventListener('canplay', onCanPlay);
        //     video.play().catch(err => {
        //         console.warn("HLS autoplay failed:", err);
        //     });
        // };
        //
        // video.addEventListener('canplay', onCanPlay);
        return;
    }

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

    // 使用 canplay 事件确保视频准备好后再调用 play()
    // const onCanPlay = () => {
    //     video.removeEventListener('canplay', onCanPlay);
    //     video.play().catch(err => {
    //         console.warn("MP4 autoplay failed:", err);
    //     });
    // };
    //
    // video.addEventListener('canplay', onCanPlay);
}
