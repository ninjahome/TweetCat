import {observeSimple} from "./utils";
import {parseContentHtml} from "./content";
import {fetchTweets} from "./content_tweet_api";
import {renderTweetsBatch} from "./tweet_render";

const selfDefineUrl = 'tweetCatTimeLine';
export function appendTweetCatMenuItem() {
    const header = document.querySelector('header[role="banner"]') as HTMLElement;
    console.log("---------------------->>>header area:",header);
    observeSimple(document.body, () => {
        return document.querySelector('header nav[role="navigation"]') as HTMLElement;
    }, (menuList) => {
        if (!!menuList.querySelector(".tweetCatMenuItem")) {
            return true;
        }

        parseContentHtml('html/content.html').then(contentTemplate => {
            const tweetCatMenuItem = contentTemplate.content.getElementById("tweetCatMenuItem")!.cloneNode(true) as HTMLElement;
            const tweetCatArea = contentTemplate.content.getElementById("tweetCatArea")!.cloneNode(true) as HTMLElement;

            const mainArea = document.querySelector('main[role="main"]') as HTMLElement;
            const originalTweetArea = mainArea.firstChild as HTMLElement;

            menuList.querySelectorAll("a").forEach(elm => {
                elm.addEventListener('click', () => {
                    tweetCatArea.style.display = 'none';
                    originalTweetArea.style.display = 'block';
                });
            });

            tweetCatMenuItem.onclick = (ev) => {
                ev.preventDefault();
                tweetCatArea.style.display = 'block'
                originalTweetArea.style.display = 'none';
                history.replaceState({id: 123}, '', '/#/' + selfDefineUrl);
                fillTweetAreaByTweets(tweetCatArea, contentTemplate).then();
            }

            menuList.insertBefore(tweetCatMenuItem, menuList.children[1]);
            mainArea.insertBefore(tweetCatArea, originalTweetArea);
        });

        return true;
    })
}

export function switchToTweetCatTimeLine() {
    const tweetCatMenuItem = document.getElementById("tweetCatMenuItem") as HTMLAnchorElement;
    tweetCatMenuItem.click();
}

async function fillTweetAreaByTweets(tweetCatArea: HTMLElement, contentTemplate: HTMLTemplateElement) {
    const validTweets = await fetchTweets('1551261351347109888', 20);//1899045104146644992 //1551261351347109888
    const fragment = renderTweetsBatch(validTweets.tweets, contentTemplate);
    tweetCatArea.append(fragment);
}

function addAutoplayObserver(root: HTMLElement): () => void {
    /** 记录目前在可见区内的所有 <video> */
    const visible = new Set<HTMLVideoElement>();

    /** 记录当前真正播放的那个 */
    let current: HTMLVideoElement | null = null;

    /** 辅助：计算某元素到视口中心点的距离平方（不做 sqrt 更快） */
    const dist2ToViewportCenter = (el: HTMLElement): number => {
        const rect = el.getBoundingClientRect();
        // 元素中心
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        // 视口中心
        const vx = window.innerWidth / 2;
        const vy = window.innerHeight / 2;
        const dx = cx - vx;
        const dy = cy - vy;
        return dx * dx + dy * dy;
    };

    let best: HTMLVideoElement | null = null;
    /** 切换播放对象 */
    const updatePlayback = () => {
        if (visible.size === 0) {
            if (current) {
                current.pause();
                current = null;
            }
            return;
        }
        // 找离中心最近的视频
        let bestScore = Number.POSITIVE_INFINITY;
        visible.forEach((v) => {
            const score = dist2ToViewportCenter(v);
            if (score < bestScore) {
                bestScore = score;
                best = v;
            }
        });
        if (best && best !== current) {
            // 切换
            if (current) current.pause();
            best.muted = true;              // 静音自动播放（避免被浏览器拦截）
            const playPromise = best.play();
            if (playPromise) {
                playPromise.catch(() => {
                    /* 浏览器策略阻止时忽略 */
                });
            }
            current = best;
        }
        // 把其余暂停
        visible.forEach((v) => {
            if (v !== current) v.pause();
        });
    };

    /** 滚动 & 尺寸变化时重新评估 */
    const scheduleUpdate = (() => {
        let ticking = false;
        return () => {
            if (!ticking) {
                ticking = true;
                requestAnimationFrame(() => {
                    ticking = false;
                    updatePlayback();
                });
            }
        };
    })();

    /** 监听可见性 */
    const io = new IntersectionObserver(
        (entries) => {
            entries.forEach((e) => {
                const vid = e.target as HTMLVideoElement;
                if (e.isIntersecting) {
                    visible.add(vid);
                } else {
                    visible.delete(vid);
                    vid.pause();
                    if (current === vid) current = null;
                }
            });
            scheduleUpdate();
        },
        {
            root: null,
            threshold: 0.25, // 元素至少 25% 进入视口才算“可见”
        }
    );

    /** 对 root 内已有和后续新增的视频都 attach */
    const attachToVideo = (v: HTMLVideoElement) => {
        // 确保不会重复 observe
        io.observe(v);
    };
    root.querySelectorAll('video').forEach((v) => attachToVideo(v as HTMLVideoElement));

    /** MutationObserver — 处理后续渲染出来的新 <video> */
    const mo = new MutationObserver((mutations) => {
        mutations.forEach((m) => {
            m.addedNodes.forEach((n) => {
                if (n instanceof HTMLVideoElement) {
                    attachToVideo(n);
                } else if (n instanceof HTMLElement) {
                    n.querySelectorAll('video').forEach((v) => attachToVideo(v as HTMLVideoElement));
                }
            });
            // 移除的节点自动由 IntersectionObserver unobserve → pause
        });
    });
    mo.observe(root, {childList: true, subtree: true});

    // 滚动和 resize
    window.addEventListener('scroll', scheduleUpdate, {passive: true});
    window.addEventListener('resize', scheduleUpdate);

    /** 调用者可在销毁时执行，以清理监听 */
    return function clean() {
        io.disconnect();
        mo.disconnect();
        window.removeEventListener('scroll', scheduleUpdate);
        window.removeEventListener('resize', scheduleUpdate);
        visible.forEach((v) => v.pause());
        visible.clear();
        current = null;
    };
}


async function loadCachedTweets() {
}

async function pullTweetsFromSrv() {
}

