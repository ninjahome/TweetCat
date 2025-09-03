// server.js
import http from 'node:http';
import {URL} from 'node:url';
import {Innertube} from 'youtubei.js'; // Node 侧用默认入口

const PORT = 4545;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const AL = 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7';
// 简单 CORS（允许网页/inject 访问）
function setCORS(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
}

// 复用一个 Node 端的 Innertube（用于 /download）
let YT_PROMISE;

function getYT() {
    if (!YT_PROMISE) {
        YT_PROMISE = Innertube.create({retrieve_player: true});
    }
    return YT_PROMISE;
}

// 把 Headers 对象转为普通对象
function headersToObject(h) {
    const out = {};
    for (const [k, v] of Object.entries(h || {})) out[k] = v;
    return out;
}

const server = http.createServer(async (req, res) => {
    setCORS(res);
    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const u = new URL(req.url, `http://${req.headers.host}`);

    // 1) 透传：POST /proxy   { url, init }
    if (req.method === 'POST' && u.pathname === '/proxy') {
        try {
            const chunks = [];
            for await (const c of req) chunks.push(c);
            const {url, init} = JSON.parse(Buffer.concat(chunks).toString('utf8'));

            // 日志：看清失败的是谁
            console.log('[proxy POST] =>', init?.method || 'GET', url);

            // 合并 headers，确保带上 UA/语言
            const h = Object.assign(
                { 'user-agent': UA, 'accept-language': AL },
                init?.headers || {}
            );

            // 透传到目标（把 headers/body 原样带过去）
            const r = await fetch(url, {
                method: init?.method || 'GET',
                headers: h,
                body: init?.body,       // Innertube 在浏览器里基本发字符串 JSON，这里原样转发
                redirect: 'follow',
            });

            // 失败时打印一行
            if (!r.ok) console.warn('[proxy POST] <', r.status, r.statusText, 'for', url);

            // 把响应转回给前端（以 ArrayBuffer 形式）
            const ab = await r.arrayBuffer();
            for (const [k, v] of r.headers) res.setHeader(k, v);
            res.writeHead(r.status);
            res.end(Buffer.from(ab));
        } catch (e) {
            res.writeHead(500, {'content-type': 'application/json'});
            res.end(JSON.stringify({error: String(e)}));
        }
        return;
    }

    // 2) 透传：GET /proxy?url=…   （用于分段/直链：浏览器直接 GET 到本机代理）
    if (req.method === 'GET' && u.pathname === '/proxy') {
        const target = u.searchParams.get('url');
        if (!target) {
            res.writeHead(400).end('missing url');
            return;
        }
        try {
            console.log('[proxy GET] =>', target);
            const r = await fetch(target, {
                headers: { 'user-agent': UA, 'accept-language': AL },
                redirect: 'follow'
            });

            if (!r.ok) console.warn('[proxy GET] <', r.status, r.statusText, 'for', target);

            for (const [k, v] of r.headers) res.setHeader(k, v);
            res.writeHead(r.status);
            const reader = r.body.getReader();
            for (; ;) {
                const {value, done} = await reader.read();
                if (done) break;
                res.write(Buffer.from(value));
            }
            res.end();
        } catch (e) {
            console.error('[proxy GET] ERROR', e);
            res.writeHead(502, {'content-type': 'text/plain'});
            res.end('proxy fetch failed: ' + String(e));
        }
        return;
    }

    // 3) 下载：GET /download?videoId=...&itag=...
    //    服务器侧用 youtubei.js 找到对应 format（限 progressive），以附件流回给浏览器
    if (req.method === 'GET' && u.pathname === '/download') {
        const videoId = u.searchParams.get('videoId');
        const itag = Number(u.searchParams.get('itag'));
        if (!videoId || !Number.isFinite(itag)) {
            res.writeHead(400, {'content-type': 'text/plain'});
            res.end('missing videoId or itag');
            return;
        }
        try {
            const yt = await getYT();
            const info = await yt.getInfo(videoId, {client: 'TV'}); // TV/ANDROID 都可
            const f = info.basic_info?.streaming_data?.formats
                ?.concat(info.basic_info?.streaming_data?.adaptive_formats || [])
                ?.find(x => Number(x.itag) === itag);
            if (!f) {
                res.writeHead(404).end('itag not found');
                return;
            }
            if (!f.url && f.signatureCipher) {
                // Node 端也能解密；但最小实现：让 Innertube 自己解
                const fresh = await yt.actions.execute('/player', {videoId, client: 'ANDROID', parse: true});
                const sd = fresh?.streamingData;
                const ff = [...(sd?.formats || []), ...(sd?.adaptiveFormats || [])].find(x => Number(x.itag) === itag);
                if (ff?.url) f.url = ff.url;
            }
            if (!f.url) {
                res.writeHead(409).end('no direct url for this itag');
                return;
            }

            // 以附件形式透传回浏览器
            res.setHeader('content-disposition', `attachment; filename="${videoId}.${(f.mimeType || 'video/mp4').split('/')[1].split(';')[0]}"`);
            const r = await fetch(f.url, {redirect: 'follow'});
            for (const [k, v] of r.headers) res.setHeader(k, v);
            res.writeHead(r.status);
            const reader = r.body.getReader();
            for (; ;) {
                const {value, done} = await reader.read();
                if (done) break;
                res.write(Buffer.from(value));
            }
            res.end();
        } catch (e) {
            res.writeHead(500, {'content-type': 'text/plain'});
            res.end('download error: ' + String(e));
        }
        return;
    }

    res.writeHead(404).end('not found');
});

server.listen(PORT, () => {
    console.log(`Proxy listening on http://127.0.0.1:${PORT}`);
});
