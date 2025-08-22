import {setTweetCatFlag} from "./route_helper";

export function isTwitterStatusUrl(href: string | undefined): boolean {
    if (!href) return false;
    try {
        const u = new URL(href);
        const host = u.hostname.toLowerCase();
        if (host !== 'twitter.com' && host !== 'www.twitter.com' &&
            host !== 'x.com' && host !== 'www.x.com') return false;
        return /\/[^/]+\/status\/\d+/.test(u.pathname);
    } catch {
        return false;
    }
}

export function bindTwitterInternalLink(element: HTMLAnchorElement, path: string) {
    if (element.dataset.hasProtected === 'true') return;

    // 仅允许以 “/” 开头的站内相对路径；否则直接退出
    if (!path || path === '#' || !path.startsWith('/')) {
        return;
    }

    element.href = path;
    element.addEventListener('click', (e) => {
        // 避免修饰键（如 Ctrl+Click / Cmd+Click）破坏行为
        if (
            e.defaultPrevented ||
            e.button !== 0 || // 非左键点击
            e.metaKey || e.ctrlKey || e.shiftKey || e.altKey
        ) return;

        // console.log("-------------->>>>>>", element, path)
        e.preventDefault();
        setTweetCatFlag(true);
        history.pushState({fromTweetCat: true}, '', path);
        dispatchEvent(new PopStateEvent('popstate'));
    });
    element.dataset.hasProtected = 'true';
}

