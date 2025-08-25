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

export function cloneFromTpl(tpl: HTMLTemplateElement, id: string): HTMLElement | null {
    const node = tpl.content.getElementById(id);
    return node ? (node.cloneNode(true) as HTMLElement) : null;
}

export function ensurePhotoLightbox(tpl: HTMLTemplateElement) {
    const INSTANCE_ID = 'tcqPhotoLightbox'; // 运行时实例 id
    let root = document.getElementById(INSTANCE_ID) as HTMLElement | null;

    if (!root) {
        const cloned = cloneFromTpl(tpl, 'tcqTplPhotoLightbox') as HTMLElement | null;
        if (!cloned) throw new Error('tpl tcqTplPhotoLightbox not found');
        // 兼容 cloneFromTpl 可能返回外层 .tcq-tpl：取里面的真正根
        root = cloned.matches('.tcq-photo-lightbox')
            ? cloned
            : (cloned.querySelector('.tcq-photo-lightbox') as HTMLElement);
        if (!root) throw new Error('lightbox root missing');
        root.id = INSTANCE_ID;
        document.body.appendChild(root);
    }

    const img = root.querySelector('.tcq-plb-img') as HTMLImageElement;
    const close = root.querySelector('.tcq-plb-close') as HTMLButtonElement;

    if (!root.dataset.wired) {
        root.addEventListener('click', (e) => {
            if (e.target === root) root.hidden = true;
        });
        close?.addEventListener('click', () => (root.hidden = true));
        document.addEventListener('keydown', (e) => {
            if (!root.hidden && (e.key === 'Escape' || e.key === 'Esc')) root.hidden = true;
        });
        root.dataset.wired = '1';
    }
    return {root, img, close};
}

