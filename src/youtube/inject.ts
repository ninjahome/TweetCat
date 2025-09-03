// inject.ts
import { Innertube, UniversalCache } from 'youtubei.js/web';

// SABR 代理地址
const PROXY = 'http://127.0.0.1:8080';

// ---- URL 改写工具 ----
function toProxy(input: string | URL | Request): string {
    const u = input instanceof URL
        ? input
        : (input instanceof Request ? new URL(input.url) : new URL(input));
    const qs = u.search ? u.search.slice(1) : '';
    return `${PROXY}${u.pathname}?__host=${u.host}${qs ? `&${qs}` : ''}`;
}


function normHeaders(h: RequestInit['headers']) {
    if (!h) return {};
    if (h instanceof Headers) {
        const o: Record<string, string> = {};
        h.forEach((v, k) => (o[k] = v));
        return o;
    }
    return h as Record<string, string>;
}

async function proxyFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    // 兼容 Request 入参：从它身上取 method / headers / body
    const req = input instanceof Request ? input : null;

    const method = (init?.method ?? req?.method ?? 'GET').toUpperCase();
    const headers = normHeaders(init?.headers ?? (req?.headers || undefined));

    // 只有非 GET/HEAD 才带 body；若 init.body 没给，尝试从 Request 克隆读取
    const canHaveBody = method !== 'GET' && method !== 'HEAD';
    let body: BodyInit | undefined = undefined;
    if (canHaveBody) {
        if (
            typeof init?.body === 'string' ||
            init?.body instanceof Blob ||
            init?.body instanceof FormData ||
            init?.body instanceof URLSearchParams ||
            (typeof ReadableStream !== 'undefined' && init?.body instanceof ReadableStream)
        ) {
            body = init!.body as any;
        } else if (req && !init?.body) {
            try { body = await req.clone().text(); } catch { /* ignore */ }
        }
    }

    const proxiedUrl = toProxy(input as any); // 允许传 Request/URL/string
    return fetch(proxiedUrl, {
        method,
        headers,
        body,
        credentials: 'omit',   // SABR 返回 ACAO:*
        mode: 'cors',
        redirect: 'follow',
    });
}


// 初始化 Innertube（只执行一次）
let __ytClientPromise: Promise<any> | null = null;
async function initYT() {
    if (!__ytClientPromise) {
        __ytClientPromise = Innertube.create({
            fetch: proxyFetch,
            cache: new UniversalCache(false),
            retrieve_player: true
        });
        console.info('[YT] client via SABR proxy ready');
    }
    return __ytClientPromise;
}
(window as any).__YT_getClient = initYT;

// ========== 统一的封装 ==========

/**
 * 拉取视频信息：
 * - 用 WEB client 拿标题/描述等 meta
 * - 用 TV client 拿到 DASH/MPD
 */
async function __YT_resolveStream(videoId: string) {
    const api = await initYT();

    // WEB → meta
    const infoWeb = await api.getInfo(videoId, { client: 'WEB' });
    const title = infoWeb.basic_info?.title || '(no title)';

    // TV → 流
    const infoTv = await api.getInfo(videoId, { client: 'TV' });
    const mpd = await infoTv.toDash(u => toProxy(u));

    return { title, mpd };
}
(window as any).__YT_resolveStream = __YT_resolveStream;

// 调试提示
console.log('[YT] In console: await __YT_resolveStream("<videoId>")');