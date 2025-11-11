import browser from "webextension-polyfill";
import {addCustomStyles, parseContentHtml, sendMsgToService} from "../common/utils";
import {MsgType} from "../common/consts";
import {SnapshotV1} from "../common/msg_obj";

const IPFS_LOCAL_GATEWAY_PORTS = [8081, 8080]; // 打开CID页面优先尝试这些端口
const SW_ACTION_GET_SNAPSHOT = 'GetSnapshotV1'; // 与 background 协议一致

document.addEventListener('DOMContentLoaded', async () => {
    // --- 如果不是我们定义的特殊页面，则立即退出 ---
    if (location.hash !== '#tweetcat-ipfs') {
        return;
    }

   await onTweetCatIpfsPageLoaded();
});

async function onTweetCatIpfsPageLoaded() {
    addCustomStyles('css/tweetcat-ipfs.css');
    const tpl = await parseContentHtml('html/tweetcat-ipfs.html');

    document.body.innerHTML = '';
    const div = tpl.content.getElementById("tc-root") as HTMLElement;
    document.body.appendChild(div);

    const logo = document.getElementById('tc-logo') as HTMLImageElement | null;
    if (logo) {
        logo.src = browser.runtime.getURL('images/tweetcat.svg');
    }

    bindUI();
    await requestAndRenderSnapshot();
}

function bindUI() {
    const refreshBtn = document.getElementById('tc-refresh') as HTMLButtonElement | null;
    const uploadBtn = document.getElementById('tc-upload') as HTMLButtonElement | null;
    const copyCidBtn = document.getElementById('tc-copy-cid') as HTMLButtonElement | null;

    refreshBtn?.addEventListener('click', async () => {
        await requestAndRenderSnapshot(true);
    });

    uploadBtn?.addEventListener('click', async () => {
        await handleUploadClick();
    });

    copyCidBtn?.addEventListener('click', () => {
        const link = document.getElementById('tc-cid-link') as HTMLAnchorElement | null;
        if (link && link.dataset.cid) {
            navigator.clipboard?.writeText(link.dataset.cid).then(() => {
                showStatus('CID 已复制到剪贴板');
            }, () => {
                showStatus('复制失败，请手动复制');
            });
        }
    });
}

async function requestAndRenderSnapshot(forceRefresh = false) {
    setStatus('请求后台 Snapshot…');
    try {
        const rsp = await sendMsgToService({}, MsgType.SW_ACTION_GET_SNAPSHOT);
        if (!rsp || !rsp.success || !rsp.data) {
            const msg = (rsp && (rsp.error || rsp.data)) ?? '无法从后台获取快照';
            setStatus(msg);
            renderJson(null);
            return;
        }

        const snapshot = rsp.data as SnapshotV1;
        renderJson(snapshot);
        setStatus(`快照时间：${snapshot.createdAt}`);
    } catch (err) {
        console.error('request snapshot error', err);
        setStatus('请求后台快照失败：' + (err as Error).message);
        renderJson(null);
    }
}

function renderJson(snapshot: SnapshotV1 | null) {
    const pre = document.getElementById('tc-json') as HTMLElement | null;
    const results = document.getElementById('tc-results') as HTMLElement | null;
    const cidLink = document.getElementById('tc-cid-link') as HTMLAnchorElement | null;
    if (!pre) return;
    if (!snapshot) {
        pre.textContent = '（无可用快照）';
        results?.classList.add('hidden');
        if (cidLink) {
            cidLink.textContent = '';
            cidLink.href = '#';
            cidLink.removeAttribute('data-cid');
        }
        return;
    }
    // 美化并只读显示
    pre.textContent = JSON.stringify(snapshot, null, 2);
    results?.classList.add('hidden');
}

function setStatus(text: string) {
    const el = document.getElementById('tc-status') as HTMLElement | null;
    if (!el) return;
    el.textContent = text;
}

/** 上传并 pin 到本地 Kubo 节点（使用当前 tab 的 origin 作为 API base） */
async function handleUploadClick() {
    try {
        // 1) 读取当前展示的 snapshot（从 pre）
        const pre = document.getElementById('tc-json') as HTMLElement | null;
        if (!pre || !pre.textContent) {
            showStatus('没有可用快照可上传');
            return;
        }
        const snapshotText = pre.textContent;
        let snapshotJson: SnapshotV1;
        try {
            snapshotJson = JSON.parse(snapshotText);
        } catch (err) {
            showStatus('快照内容不是有效 JSON，无法上传');
            return;
        }

        // 2) 以 FormData 上传到本地 Kubo API （当前 tab 的 origin）
        const apiBase = deriveKuboApiBaseFromLocation();
        if (!apiBase) {
            showStatus('无法推断本地 IPFS API 地址');
            return;
        }
        setStatus('正在上传测试数据到 IPFS...');
        const cid = await uploadJsonToLocalKubo(snapshotJson, apiBase);
        setStatus('上传成功！CID: ' + cid);
        await navigator.clipboard?.writeText(cid).catch(() => {
        });
        showUploadResult(cid);
        // 3) 打开本地网关以展示（优先 8081）
        const gwUrl = deriveLocalGatewayViewUrl(cid);
        if (gwUrl) {
            window.open(gwUrl, '_blank');
        }
    } catch (err) {
        console.error('upload error', err);
        showStatus('上传失败：' + ((err as Error).message || String(err)));
    }
}

function showUploadResult(cid: string) {
    const results = document.getElementById('tc-results') as HTMLElement | null;
    const cidLink = document.getElementById('tc-cid-link') as HTMLAnchorElement | null;
    const gatewayLinks = document.getElementById('tc-gateway-links') as HTMLElement | null;
    if (!results || !cidLink || !gatewayLinks) return;
    results.classList.remove('hidden');
    cidLink.textContent = cid;
    cidLink.href = '#';
    cidLink.dataset.cid = cid;

    // build some gateway candidates
    gatewayLinks.innerHTML = '';
    for (const port of IPFS_LOCAL_GATEWAY_PORTS) {
        const a = document.createElement('a');
        a.href = `http://127.0.0.1:${port}/ipfs/${cid}`;
        a.textContent = `本地 ${port} 网关`;
        a.target = '_blank';
        a.rel = 'noopener';
        gatewayLinks.appendChild(a);
    }
    // public fallback
    const pub = document.createElement('a');
    pub.href = `https://ipfs.io/ipfs/${cid}`;
    pub.textContent = 'ipfs.io 网关';
    pub.target = '_blank';
    pub.rel = 'noopener';
    gatewayLinks.appendChild(pub);
}

function deriveKuboApiBaseFromLocation(): string | null {
    // 当 content script 被注入到 Kubo UI 页时，location.origin 通常是 http://127.0.0.1:5001
    // 我们以当前 origin（如果看起来像 ip/localhost）为准
    try {
        const o = new URL(location.origin);
        if (o.hostname === '127.0.0.1' || o.hostname === 'localhost') {
            return o.origin; // e.g. http://127.0.0.1:5001
        }
    } catch (_) {
    }
    // 若当前页不是 Kubo UI（例如页面是其他），尝试常见端口
    // 但优先不猜测，返回 null 表示无法推断
    return null;
}

function deriveLocalGatewayViewUrl(cid: string): string | null {
    // prefer 8081 then 8080
    for (const p of IPFS_LOCAL_GATEWAY_PORTS) {
        return `http://127.0.0.1:${p}/ipfs/${cid}`;
    }
    return `https://ipfs.io/ipfs/${cid}`;
}

/** 将 JSON 上传为 file 到 /api/v0/add?pin=true，返回 CID */
async function uploadJsonToLocalKubo(obj: any, apiBase: string): Promise<string> {
    // apiBase 例如 "http://127.0.0.1:5001"
    const url = `${apiBase}/api/v0/add?pin=true&wrap-with-directory=false`;
    const blob = new Blob([JSON.stringify(obj)], {type: 'application/json'});
    const form = new FormData();
    form.append('file', blob, 'snapshot.json');

    // Kubo 的 add API 会返回 NDJSON 或 JSON 行，我们解析最后一行的 JSON
    const resp = await fetch(url, {
        method: 'POST',
        body: form,
    });
    if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(`Kubo 上传失败: HTTP ${resp.status} ${text}`);
    }
    const text = await resp.text();
    // Kubo 有时候返回多行，最后一行包含 Hash 字段
    const lines = text.trim().split(/\r?\n/).filter(Boolean);
    const last = lines[lines.length - 1];
    try {
        const parsed = JSON.parse(last);
        const cid = parsed.Hash || parsed.IpfsHash || parsed.Hash;
        if (!cid) throw new Error('未在返回值找到 CID');
        return cid;
    } catch (err) {
        throw new Error('解析 Kubo 返回失败: ' + String(err));
    }
}

function showStatus(s: string) {
    setStatus(s);
    console.info('[TweetCat IPFS helper] ', s);
}
