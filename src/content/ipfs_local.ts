import browser from "webextension-polyfill";
import {addCustomStyles, parseContentHtml, sendMsgToService} from "../common/utils";
import {MsgType} from "../common/consts";
import {SnapshotV1} from "../common/msg_obj";

let gatewayBase: string = 'http://127.0.0.1:8080/ipfs'
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
    gatewayBase = (await getGatewayBaseFromSW()) ?? gatewayBase;
    bindUI();
    await requestAndRenderSnapshot();
}

async function getGatewayBaseFromSW(): Promise<string | null> {
    try {
        const rsp = await sendMsgToService({}, MsgType.IPFS_GET_GATEWAY_BASE);
        console.log("-------->>>>>local ipfs settings:",rsp);
        if (rsp?.success && typeof rsp.data === 'string' && rsp.data.trim() !== '') {
            return rsp.data.trim().replace(/\/+$/, ''); // 去尾斜杠
        }
    } catch (_) {}
    // fallback
    return 'http://127.0.0.1:8080/ipfs';
}
function bindUI() {
    const refreshBtn = document.getElementById('tc-refresh') as HTMLButtonElement | null;
    const uploadBtn  = document.getElementById('tc-upload')  as HTMLButtonElement | null;
    const copyCidBtn = document.getElementById('tc-copy-cid') as HTMLButtonElement | null;

    refreshBtn?.addEventListener('click', () => requestAndRenderSnapshot());
    uploadBtn?.addEventListener('click', () => handleUploadClick());
    copyCidBtn?.addEventListener('click', copyCid);
}

function copyCid() {
    const link = document.getElementById('tc-cid-link') as HTMLAnchorElement | null;
    if (link?.dataset.cid) {
        navigator.clipboard?.writeText(link.dataset.cid)
            .then(() => showStatus('CID 已复制到剪贴板'))
            .catch(() => showStatus('复制失败，请手动复制'));
    }
}

async function requestAndRenderSnapshot() {
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
        let snapshotJson: SnapshotV1 = JSON.parse(snapshotText);

        // 2) 以 FormData 上传到本地 Kubo API （当前 tab 的 origin）
        const apiBase = deriveApiFromLocation();
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
        const gwUrl = `${gatewayBase}/${cid}`;
        window.open(gwUrl, '_blank');

    } catch (err) {
        console.error('upload error', err);
        showStatus('上传失败：' + ((err as Error).message || String(err)));
    }
}
function showUploadResult(cid: string) {
    const results = document.getElementById('tc-results') as HTMLElement | null;
    const cidLink = document.getElementById('tc-cid-link') as HTMLAnchorElement | null;
    const localLink = document.getElementById('tc-link-local') as HTMLAnchorElement | null;
    const publicLink = document.getElementById('tc-link-public') as HTMLAnchorElement | null;

    if (!results || !cidLink || !localLink || !publicLink) return;

    results.classList.remove('hidden');
    cidLink.textContent = cid;
    cidLink.dataset.cid = cid;
    cidLink.href = `https://ipfs.io/ipfs/${cid}`;

    const localUrl = `${gatewayBase}/${cid}`;
    localLink.href = localUrl;
    localLink.textContent = localUrl;

    const publicUrl = `https://ipfs.io/ipfs/${cid}`;
    publicLink.href = publicUrl;
    publicLink.textContent = publicUrl;
}

function deriveApiFromLocation(): string | null {
    try {
        const o = new URL(location.origin);
        if (['127.0.0.1', 'localhost'].includes(o.hostname)) return o.origin;
    } catch {}
    return null;
}

async function uploadJsonToLocalKubo(obj: any, apiBase: string): Promise<string> {
    const url = `${apiBase}/api/v0/add?pin=true&wrap-with-directory=false`;
    const blob = new Blob([JSON.stringify(obj)], { type: 'application/json' });
    const form = new FormData();
    form.append('file', blob, 'snapshot.json');

    const resp = await fetch(url, { method: 'POST', body: form });
    const text = await resp.text();
    if (!resp.ok) {
        throw new Error(`Kubo 上传失败: HTTP ${resp.status} ${text}`);
    }
    const lines = text.trim().split(/\r?\n/).filter(Boolean);
    const parsed = JSON.parse(lines.pop()!);
    const cid = parsed.Hash || parsed.IpfsHash;
    if (!cid) throw new Error('未在返回值找到 CID');
    return cid;
}

function showStatus(s: string) {
    setStatus(s);
    console.info('[TweetCat IPFS helper] ', s);
}
