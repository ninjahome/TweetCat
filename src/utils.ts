import browser from "webextension-polyfill";
import {localGet} from "./local_storage";
import {__DBK_Bearer_Token, DEFAULT_BEARER} from "./consts";

export async function sendMsgToService(data: any, actTyp: string): Promise<any> {
    try {
        return await browser.runtime.sendMessage({
            action: actTyp,
            data: data,
        });
    } catch (e) {
        const error = e as Error;
        console.warn("------>>>send message error", error, data, actTyp);
        return {success: false, data: error.message}
    }
}

export function showView(hash: string, callback?: (hash: string) => void): void {
    const views = document.querySelectorAll<HTMLElement>('.page_view');
    views.forEach(view => view.style.display = 'none');

    const id = hash.replace('#onboarding/', 'view-');
    const targetView = document.getElementById(id);
    if (targetView) {
        targetView.style.display = 'block';
    } else {
        console.log("------>>> failed to find view for router hash:", hash);
    }
    if (callback) {
        callback(hash);
    }
}

export function addCustomStyles(cssFilePath: string): void {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.type = 'text/css';
    link.href = browser.runtime.getURL(cssFilePath);
    document.head.appendChild(link);
}

export function isTwitterUserProfile(): string | null {
    const path = window.location.pathname;
    const excludedPaths = [
        'home', 'explore', 'notifications', 'messages',
        'settings', 'login', 'signup'
    ];

    // 允许匹配这些后缀路径
    const allowedSuffixes = ['', 'affiliates', 'with_replies', 'highlights', 'media', 'superfollows'];

    const pathParts = path.split('/').filter(Boolean); // 去掉空串

    // 只处理 /username 或 /username/xxx（最多两段）
    if (pathParts.length === 0 || pathParts.length > 2) {
        return null;
    }

    const [username, subPath] = pathParts;

    // 排除保留路径
    if (excludedPaths.includes(username)) {
        return null;
    }

    // 如果是带子路径的，只允许特定后缀
    if (subPath && !allowedSuffixes.includes(subPath)) {
        return null;
    }

    return username;
}


function observeAction(target: HTMLElement, idleThreshold: number,
                       foundFunc: () => HTMLElement | null, callback: (elmFound: HTMLElement) => Promise<void>,
                       options: MutationObserverInit, continueMonitor?: boolean) {
    const cb: MutationCallback = (_, observer) => {
        const element = foundFunc();
        if (!element) {
            return;
        }
        if (!continueMonitor) {
            observer.disconnect();
        }
        let idleTimer = setTimeout(() => {
            callback(element).then();
            clearTimeout(idleTimer);
            // console.log('---------->>> observer action finished:=> continue=>', continueMonitor);
        }, idleThreshold);
    };

    const observer = new MutationObserver(cb);
    observer.observe(target, options);
}

export function observeForElement(target: HTMLElement, idleThreshold: number,
                                  foundFunc: () => HTMLElement | null, callback: (elmFound: HTMLElement) => Promise<void>,
                                  continueMonitor?: boolean) {

    observeAction(target, idleThreshold, foundFunc, callback, {childList: true, subtree: true}, continueMonitor);
}

export function observeForElementDirect(target: HTMLElement, idleThreshold: number,
                                        foundFunc: () => HTMLElement | null, callback: (elmFound: HTMLElement) => Promise<void>,
                                        continueMonitor?: boolean) {
    observeAction(target, idleThreshold, foundFunc, callback, {childList: true, subtree: false}, continueMonitor);
}


export async function getBearerToken(): Promise<string> {
    const cached = await localGet(__DBK_Bearer_Token);
    if (cached) return cached;
    return DEFAULT_BEARER;
}

export function isAdTweetNode(node: HTMLElement): boolean {
    // 特征 1：有 top-impression-pixel 等广告 tracking dom
    const hasImpressionTracking = node.querySelector('[data-testid="top-impression-pixel"]') !== null;

    // 特征 2（可选）：检测 span 的文本是否为 "Ad"、"推广" 等，作为额外冗余判断
    const adKeywords = ['Ad', '推广', '広告', 'Anuncio', 'Publicité', 'Anzeige', '광고'];
    const hasAdKeyword = Array.from(node.querySelectorAll("span"))
        .some(span => adKeywords.includes(span.textContent?.trim() ?? ""));

    return hasImpressionTracking || hasAdKeyword;
}


/************************************************************************************
 *************************************************************************************
 *       属性                | 说明                                                   *
 *   mutation.type          | 是什么类型的变化（childList、attributes、characterData）  *
 *   mutation.target        | 变化的元素                                              *
 *   mutation.addedNodes    | 新加了哪些节点（childList类型专用）                        *
 *   mutation.removedNodes  | 删掉了哪些节点（childList类型专用）                        *
 *   mutation.attributeName | 改了哪个属性（attributes类型专用，比如class, style）       *
 *   mutation.oldValue      | 改变前的值是什么                                         *
 *************************************************************************************
 *  for (const mutation of mutationsList) {
 *  if (mutation.type === 'childList' || mutation.type === 'attributes') {}
 *  }                                            *
 *************************************************************************************/

export function observeSimple(targetNode: HTMLElement,
                              judgeFunc: (mutationsList: MutationRecord[]) => HTMLElement | null,
                              callback: (elm: HTMLElement) => boolean,
                              attributes: boolean = false): MutationObserver {
    const observer = new MutationObserver(async (mutationsList) => {
        const elm = judgeFunc(mutationsList);
        if (!elm) {
            return;
        }

        if (callback(elm)) {
            observer.disconnect();
        }
    });

    observer.observe(targetNode, {
        childList: true,
        subtree: true,
        attributes: attributes,
    });

    return observer;
}

export function formatCount(n: number): string {
    if (n >= 1_000_000) {
        return (n / 1_000_000).toFixed(n % 1_000_000 >= 100_000 ? 1 : 0) + 'M';
    } else if (n >= 1_000) {
        return (n / 1_000).toFixed(n % 1_000 >= 100 ? 1 : 0) + 'K';
    } else {
        return n.toString();
    }
}


/**
 * Friendly time‑ago / date stamp — mirrors Twitter UI behaviour.
 *   • < 60 s   →  "xs ago" / "x秒前"
 *   • < 60 min →  "xm ago" / "x分钟前"
 *   • < 24 h   →  "xh ago" / "x小时前"
 *   • < 7 d    →  "xd ago" / "x天前"
 *   • ≥ 7 d    →  "May 5" / "5月5日"
 */
export function formatTweetTime(
    dateString: string,
    locale: 'auto' | 'zh' | 'en' = 'auto',
): string {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);

    // 自动侦测语言
    let finalLocale = locale;
    if (locale === 'auto') {
        const lang = (navigator.language || 'en').toLowerCase();
        finalLocale = lang.startsWith('zh') ? 'zh' : 'en';
    }

    if (diffSeconds < 60) {
        return finalLocale === 'zh' ? `${diffSeconds}秒` : `${diffSeconds}s`;
    }
    if (diffMinutes < 60) {
        return finalLocale === 'zh' ? `${diffMinutes}分钟` : `${diffMinutes}m`;
    }
    if (diffHours < 24) {
        return finalLocale === 'zh' ? `${diffHours}小时` : `${diffHours}h`;
    }
    if (diffDays < 7) {
        return finalLocale === 'zh' ? `${diffDays}天` : `${diffDays}d`;
    }
    // ≥ 7 天: 显示具体年月日（Twitter 也会在跨年时带年份；此处简化按当年处理）
    if (finalLocale === 'zh') {
        return `${date.getMonth() + 1}月${date.getDate()}日`;
    }
    return date.toLocaleDateString('en-US', {month: 'short', day: 'numeric'});
}
