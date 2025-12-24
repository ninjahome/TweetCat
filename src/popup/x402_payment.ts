import {isSignedIn} from "@coinbase/cdp-core";
import {initCDP, X402_FACILITATORS, x402TipPayload} from "../common/x402_obj";
import {getChainId} from "../wallet/wallet_setting";
import browser from "webextension-polyfill";
import {initX402Client} from "../wallet/cdp_wallet";

const WORKER_URL = "https://tweetcattips.ribencong.workers.dev";

// DOM 元素
let statusDiv: HTMLElement;
let loadingDiv: HTMLElement;
let tweetInfoDiv: HTMLElement;
let btnClose: HTMLElement;

document.addEventListener("DOMContentLoaded", async () => {
    // 获取 DOM 元素
    statusDiv = document.getElementById('status')!;
    loadingDiv = document.getElementById('loading')!;
    tweetInfoDiv = document.getElementById('tweetInfo')!;
    btnClose = document.getElementById('btnClose')!;

    btnClose.onclick = () => window.close();

    // 从 URL 参数获取 payload
    const params = new URLSearchParams(window.location.search);
    const payloadStr = params.get('payload');

    if (!payloadStr) {
        showError('缺少支付参数');
        return;
    }

    try {
        const payload: x402TipPayload = JSON.parse(decodeURIComponent(payloadStr));

        // 显示推文信息
        showTweetInfo(payload);

        // 执行支付
        await processTipPayment(payload);
    } catch (err) {
        console.error('Payment initialization error:', err);
        showError(err.message);
    }
});

function showTweetInfo(payload: x402TipPayload) {
    document.getElementById('tweetId')!.textContent = payload.tweetId;
    document.getElementById('authorId')!.textContent = payload.authorId;
    document.getElementById('amount')!.textContent = payload.usdcVal.toFixed(2);
    tweetInfoDiv.style.display = 'block';

}

async function processTipPayment(payload: x402TipPayload) {
    try {
        await initCDP();

        // 1. 检查登录状态
        updateStatus('检查登录状态...');
        const signed = await isSignedIn();
        if (!signed) {
            showError('请先登录 Coinbase 钱包');
            setTimeout(() => {
                browser.tabs.create({
                    url: browser.runtime.getURL('html/cdp_auth.html')
                });
                window.close();
            }, 2000);
            return;
        }

        // 2. 验证金额
        updateStatus('验证支付金额...');
        if (!payload.usdcVal || payload.usdcVal <= 0 || payload.usdcVal > 1000) {
            throw new Error('无效的支付金额');
        }

        // 3. 获取链信息
        updateStatus('获取网络信息...');
        const chainId = await getChainId();
        const settleAddress = X402_FACILITATORS[chainId].settlementContract;

        // 4. 构造支付 URL
        const tipUrl = `${WORKER_URL}/tip?payTo=${settleAddress}&amount=${payload.usdcVal}&tweetId=${payload.tweetId}&authorId=${payload.authorId}`;

        console.log('✅ Requesting x402 payment:', tipUrl);

        // 5. 执行 x402 支付
        updateStatus('正在请求支付...\n请在弹出的窗口中确认');

        const selfFetch = await initX402Client()

        const response = await selfFetch(tipUrl, {
            method: 'GET',
            headers: {
                "Content-Type": "application/json"
            }
        });


        if (!response.ok) {
            // 💡 使用 forEach 打印所有 Header，用于排查 CORS 问题
            const headersObj: Record<string, string> = {};
            response.headers.forEach((value, key) => {
                headersObj[key] = value;
            });

            console.log("🔍 Received Headers:", headersObj);

            // 检查是否存在支付请求头（注意：浏览器通常会将 Header 转为小写）
            const hasPaymentReq = !!(headersObj['payment-required'] || headersObj['PAYMENT-REQUIRED']);

            if (response.status === 402) {
                if (!hasPaymentReq) {
                    console.error("❌ 拦截器失效：Headers 中缺少 payment-required。请检查 Worker 的 CORS exposeHeaders 配置。");
                } else {
                    console.log("✅ 拦截器收到了 Header，但未触发。可能是 Signer 或 Network 配置不匹配。");
                }
            }

            const text = await response.text();
            throw new Error(`支付后请求失败 (${response.status}): ${text}`);
        }

        const result = await response.json();
        console.log('✅ Payment success:', result);

        // 6. 显示成功
        const txHash = result.txHash || result.transactionHash;
        showSuccess(`✅ 打赏成功！`, txHash);

        // 7. 自动关闭（延迟以便用户看到结果）
        setTimeout(() => {
            window.close();
        }, 50000);

    } catch (err) {
        console.error('❌ Payment error:', err);
        showError(err.message || '支付过程中发生错误');
    }
}

function updateStatus(msg: string) {
    statusDiv.textContent = msg;
    statusDiv.className = 'status';
}

function showError(msg: string) {
    loadingDiv.style.display = 'none';
    statusDiv.textContent = `❌ ${msg}`;
    statusDiv.className = 'status error';
    btnClose.style.display = 'block';
}

function showSuccess(msg: string, txHash?: string) {
    loadingDiv.style.display = 'none';

    let html = `<div>${msg}</div>`;
    if (txHash) {
        html += `<div class="txhash">TxHash: ${txHash}</div>`;
    }
    html += `<div style="margin-top: 12px; font-size: 14px;">窗口将在 5 秒后自动关闭</div>`;

    statusDiv.innerHTML = html;
    statusDiv.className = 'status success';
}