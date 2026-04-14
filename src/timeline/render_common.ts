import {setTweetCatFlag} from "./route_helper";
import {t} from "../common/i18n";

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

export function ensurePhotoLightbox() {
    let root = document.getElementById('tcqPhotoLightbox') as HTMLElement;
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

export function resolutionToNearestP(url: string): string {
    const m = url.match(/\/(\d+)x(\d+)\//);
    if (!m) return `${360}p`;
    const w = Number(m[1]), h = Number(m[2]);
    if (!Number.isFinite(w) || !Number.isFinite(h)) return `${360}p`;

    const shortEdge = Math.min(w, h);
    const ladder = [144, 240, 360, 480, 540, 720, 1080, 1440, 2160];
    let best = ladder[0], bestDiff = Math.abs(shortEdge - best);
    for (let i = 1; i < ladder.length; i++) {
        const diff = Math.abs(shortEdge - ladder[i]);
        if (diff < bestDiff) {
            best = ladder[i];
            bestDiff = diff;
        }
    }
    return `${best}p`;
}

export function indexToGrade(idx: number, total: number): string {
    if (total <= 1) return t('quality');
    if (total === 2) return idx === 0 ? t('quality_low') : t('quality_high');
    if (idx === 0) return t('quality_low');
    if (idx === total - 1) return t('quality_high');
    return t('quality_mid');
}

