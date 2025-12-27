import {isSignedIn} from "@coinbase/cdp-core";
import {initCDP, X402_FACILITATORS, x402TipPayload} from "../common/x402_obj";
import {getChainId} from "../wallet/wallet_setting";
import {logX402} from "../common/debug_flags";
import {t} from "../common/i18n";
import {postToX402Srv} from "../wallet/cdp_wallet";

// DOM 元素
let statusDiv: HTMLElement;
let loadingDiv: HTMLElement;
let tweetInfoDiv: HTMLElement;
let btnClose: HTMLElement;

// 翻译函数
function translateStaticTexts() {
    // 设置页面标题
    document.title = t('page_title');

    // 设置页面标题
    const pageHeader = document.getElementById('pageHeader');
    if (pageHeader) {
        pageHeader.textContent = t('page_header');
    }

    // 设置推文标签
    const tweetIdLabel = document.getElementById('tweetIdLabel');
    if (tweetIdLabel) {
        tweetIdLabel.textContent = t('tweet_id_label');
    }

    const authorIdLabel = document.getElementById('authorIdLabel');
    if (authorIdLabel) {
        authorIdLabel.textContent = t('author_id_label');
    }

    // 设置货币单位
    const currencyUnit = document.getElementById('currencyUnit');
    if (currencyUnit) {
        currencyUnit.textContent = t('currency_unit');
    }

    // 设置关闭按钮
    if (btnClose) {
        btnClose.textContent = t('close_button');
    }

    // 设置初始状态文本
    const defaultStatusText = statusDiv.getAttribute('data-default-text');
    if (defaultStatusText) {
        statusDiv.textContent = t('initializing_status');
    }
}

document.addEventListener("DOMContentLoaded", async () => {
    // 获取 DOM 元素
    statusDiv = document.getElementById('status')!;
    loadingDiv = document.getElementById('loading')!;
    tweetInfoDiv = document.getElementById('tweetInfo')!;
    btnClose = document.getElementById('btnClose')!;

    translateStaticTexts();

    btnClose.onclick = () => window.close();

    // 从 URL 参数获取 payload
    const params = new URLSearchParams(window.location.search);
    const payloadStr = params.get('payload');

    if (!payloadStr) {
        showError(t('missing_payload_error'));
        return;
    }
    try {
        const payload: x402TipPayload = JSON.parse(decodeURIComponent(payloadStr));
        showTweetInfo(payload);
        await processTipPayment(payload);
    } catch (err) {
        console.error('Payment initialization error:', err);
        showError(err.message || t('initialization_error'));
    }
});

function showTweetInfo(payload: x402TipPayload) {
    const tweetIdElement = document.getElementById('tweetId');
    const authorIdElement = document.getElementById('authorId');
    const amountElement = document.getElementById('amount');

    if (tweetIdElement) tweetIdElement.textContent = payload.tweetId;
    if (authorIdElement) authorIdElement.textContent = payload.authorId;
    if (amountElement) amountElement.textContent = payload.usdcVal.toFixed(2);

    tweetInfoDiv.style.display = 'block';
}

async function processTipPayment(payload: x402TipPayload) {
    try {
        await initCDP();

        updateStatus(t('checking_login_status'));
        const signed = await isSignedIn();
        if (!signed) {
            showError(t('coinbase_login_error'));
            return
        }

        updateStatus(t('verifying_payment_amount'));
        if (!payload.usdcVal || payload.usdcVal <= 0 || payload.usdcVal > 1000) {
            showError(t('invalid_payment_amount'));
            return
        }

        updateStatus(t('fetching_network_info'));
        const chainId = await getChainId();
        const end_point = X402_FACILITATORS[chainId].endpoint + "/tip";

        updateStatus(t('requesting_payment'));

        const response = await postToX402Srv(end_point, {
            amount: payload.usdcVal,
            tweetId: payload.tweetId,
            xId: payload.authorId
        })

        if (!response.ok) {
            const text = await response.text();
            logX402("------>>>x402 error:", text);
            showError(`${t('post_payment_failure')} (${response.status}): ${text}`);
            return
        }
        const result = await response.json();

        const txHash = result.txHash || result.transactionHash;
        logX402("-------x402>>>result,", result)
        showSuccess(t('tip_success'), txHash);

        setTimeout(() => {
            window.close();
        }, 10000);

    } catch (error) {
        console.error('❌ Payment error:', error);
        showError(error.message || t('payment_process_error'));
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
        html += `<div class="txhash">${t('txhash_label')}: ${txHash}</div>`;
    }
    html += `<div style="margin-top: 12px; font-size: 14px;">${t('window_auto_close')}</div>`;

    statusDiv.innerHTML = html;
    statusDiv.className = 'status success';
}