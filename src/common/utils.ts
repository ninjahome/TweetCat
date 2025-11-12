import browser from "webextension-polyfill";
import {localGet, localSet} from "./local_storage";
import {__DBK_Bearer_Token, DEFAULT_BEARER} from "./consts";


export function isLikelyCorsError(err: unknown): boolean {
    const name = String((err as any)?.name ?? '').toLowerCase();
    const msg  = String((err as any)?.message ?? err ?? '').toLowerCase();
    return (
        name === 'typeerror' && msg.includes('failed to fetch') ||   // 最常见：TypeError: Failed to fetch
        msg.includes('blocked by') ||                                 // “blocked by CORS policy”
        msg.includes('cors') ||                                       // 显式出现 “cors”
        msg.includes('net::err_failed') ||                            // 控制台里经常能看到
        msg.includes('403') || msg.includes('forbidden')              // 少数情况下会把 403 透出来
    );
}

export async function openOrUpdateTab(uiUrl:string){
    const base = uiUrl.split('#')[0];
    const tabs = await browser.tabs.query({url: base + '*'});
    if (tabs.length > 0 && tabs[0].id) {
        await browser.tabs.update(tabs[0].id, {active: true, url: uiUrl});
    } else {
        await browser.tabs.create({url: uiUrl, active: true});
    }
}

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


let memoryTokenCache: string | null = null;

export async function getBearerToken(): Promise<string> {
    if (memoryTokenCache) return memoryTokenCache;
    const cached = await localGet(__DBK_Bearer_Token);
    if (cached) return cached;
    return DEFAULT_BEARER;
}

export async function updateBearerToken(token: string) {
    memoryTokenCache = token;
    await localSet(__DBK_Bearer_Token, token);
}

export function isAdTweetNode(node: HTMLElement, atStartUp: boolean = true): boolean {

    if (atStartUp) {
        const container = node.querySelector<HTMLElement>('[data-testid="placementTracking"]');
        return !!container
    }

    const container = node.querySelector(
        '[data-testid="placementTracking"]' +
        ':has(> [data-testid="top-impression-pixel"])' +
        ':has(> [data-testid="right-impression-pixel"])' +
        ':has(> [data-testid="bottom-impression-pixel"])' +
        ':has(> [data-testid="left-impression-pixel"])'
    ) as HTMLElement | null;

    return !!container;
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

export function deferByFrames(callback: () => void, frameCount: number = 3): void {
    const step = (n: number) => {
        if (n <= 1) {
            requestAnimationFrame(() => callback());
        } else {
            requestAnimationFrame(() => step(n - 1));
        }
    };
    step(frameCount);
}

export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export type ParsedTwitterLink =
    | { kind: "tweet"; url: URL; tweetId: string; username?: string }
    | { kind: "profile"; url: URL; username: string }
    | { kind: "followersPage"; url: URL; username: string; subpage: "following" | "followers" | "verified_followers" | "followers_you_follow" } // <— 新增
    | { kind: "home"; url: URL }
    | { kind: "explore"; url: URL }
    | { kind: "other"; url: URL };

const RESERVED = new Set([
    "home", "explore", "notifications", "messages", "compose", "settings",
    "login", "signup", "i", "hashtag", "search", "share", "about", "download",
    "privacy", "tos", "intent"
]);

const PROFILE_SUFFIXES = new Set([
    "", "affiliates", "with_replies", "highlights", "media", "superfollows"
]);

// followers 系列子路由
const FOLLOWERS_SUFFIXES = new Set([
    "following", "followers", "verified_followers", "followers_you_follow"
]);

const USERNAME_RE = /^[A-Za-z0-9_]{1,15}$/;
const TWEET_ID_RE = /^\d{6,25}$/;

export function parseTwitterPath(href?: string | URL): ParsedTwitterLink {
    let u: URL;
    try {
        u = href
            ? (href instanceof URL ? href : new URL(href, location.origin))
            : new URL(location.href);
    } catch {
        return { kind: "other", url: new URL(location.href) };
    }

    const path = u.pathname;
    const parts = path.split("/").filter(Boolean);

    // —— home / explore —— //
    if (parts.length === 1) {
        if (parts[0].toLowerCase() === "home") return { kind: "home", url: u };
        if (parts[0].toLowerCase() === "explore") return { kind: "explore", url: u };
    }

    // —— 推文 —— //
    if (parts.length >= 3) {
        const [maybeUser, statusWord, id] = parts;
        if (
            USERNAME_RE.test(maybeUser) &&
            !RESERVED.has(maybeUser.toLowerCase()) &&
            (statusWord === "status" || statusWord === "statuses") &&
            TWEET_ID_RE.test(id)
        ) {
            return { kind: "tweet", url: u, username: maybeUser, tweetId: id };
        }
    }
    if (parts.length >= 4) {
        const [p0, p1, p2, id] = parts;
        if (p0 === "i" && p1 === "web" && p2 === "status" && TWEET_ID_RE.test(id)) {
            return { kind: "tweet", url: u, tweetId: id };
        }
    }

    // —— followers 系列 —— //
    if (parts.length === 2) {
        const [maybeUser, suffix] = parts;
        if (
            USERNAME_RE.test(maybeUser) &&
            !RESERVED.has(maybeUser.toLowerCase()) &&
            FOLLOWERS_SUFFIXES.has(suffix)
        ) {
            return { kind: "followersPage", url: u, username: maybeUser, subpage: suffix as any };
        }
    }

    // —— 用户主页 —— //
    if (parts.length >= 1 && parts.length <= 2) {
        const [maybeUser, suffix = ""] = parts;
        if (
            USERNAME_RE.test(maybeUser) &&
            !RESERVED.has(maybeUser.toLowerCase()) &&
            PROFILE_SUFFIXES.has(suffix)
        ) {
            return { kind: "profile", url: u, username: maybeUser };
        }
    }

    return { kind: "other", url: u };
}


export function isXArticle(u?: string | null): boolean {
    if (!u) return false;
    try {
        const url = new URL(u);
        const host = url.hostname.replace(/^www\./, '').toLowerCase();
        return (host === 'x.com' || host.endsWith('.x.com')) && url.pathname.startsWith('/i/article/');
    } catch {
        return false;
    }
}

// 新增：把 http 规范成 https，避免 http://x.com/... 造成识别/样式问题
export function toHttps(u?: string): string {
    if (!u) return "";
    try {
        const x = new URL(u);
        x.protocol = "https:";
        return x.toString();
    } catch {
        return u;
    }
}

// 在文件顶部现有 import 之后添加 / 或放到合适位置
export function formatVideoDuration(totalSeconds: number): string {
    const t = Math.max(0, Math.floor(totalSeconds));
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = t % 60;
    return h > 0
        ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
        : `${m}:${s.toString().padStart(2, '0')}`;
}


export async function parseContentHtml(htmlFilePath: string): Promise<HTMLTemplateElement> {
    const response = await fetch(browser.runtime.getURL(htmlFilePath));
    if (!response.ok) {
        throw new Error(`Failed to fetch ${htmlFilePath}: ${response.statusText}`);
    }
    const htmlContent = await response.text();
    const template = document.createElement('template');
    template.innerHTML = htmlContent;
    return template;
}

const DEFAULT_TIMEOUT = 20_000;
export async function fetchWithTimeout(url: string, options: RequestInit = {}, timeout = DEFAULT_TIMEOUT): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
        return await fetch(url, {...options, signal: controller.signal});
    } finally {
        clearTimeout(timer);
    }
}
