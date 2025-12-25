import {getCurrentUser, OAuth2ProviderType, signInWithOAuth} from "@coinbase/cdp-core";
import {sendMsgToService} from "../common/utils";
import {MsgType} from "../common/consts";
import {initCDP} from "../common/x402_obj";
import {$Id, hideLoading, showLoading} from "./common";
import {t} from "../common/i18n";

// 翻译静态文本
function translateStaticTexts() {
    // 设置页面标题
    document.title = t('connect_wallet_page_title');

    // 设置页面标题（h2）
    const pageHeader = document.getElementById('pageHeader');
    if (pageHeader) {
        pageHeader.textContent = t('connect_wallet_page_header');
    }

    // 设置描述文本
    const description = document.getElementById('description');
    if (description) {
        description.textContent = t('connect_wallet_description');
    }

    // 设置按钮文本
    const btnGoogle = document.getElementById('btn-google');
    if (btnGoogle) {
        btnGoogle.textContent = t('sign_in_with_google');
    }

    const btnApple = document.getElementById('btn-apple');
    if (btnApple) {
        btnApple.textContent = t('sign_in_with_apple');
    }

    const btnX = document.getElementById('btn-x');
    if (btnX) {
        btnX.textContent = t('sign_in_with_x');
    }
}

document.addEventListener("DOMContentLoaded", initDashBoard as EventListener);

async function initDashBoard(): Promise<void> {
    // 先翻译静态文本
    translateStaticTexts();

    showLoading(t('initializing_coinbase_wallet_sdk'));
    try {
        const params = new URLSearchParams(window.location.search);
        const code = params.get("code");
        const flowId = params.get("flow_id");
        const provider = params.get("provider_type");

        if (code && provider) {
            await handleOAuthCallback(code, flowId, provider);
            return;
        }
        await init();

    } catch (err) {
        console.error(err);
        document.body.innerText = t('initialization_failed');
    } finally {
        hideLoading();
    }
}

async function handleOAuthCallback(
    code: string,
    flowId: string | null,
    provider: string,
) {
    showStatus(t('login_success_completing_connection'));

    await initCDP()

    const user = await getCurrentUser();
    if (user) {
        showStatus(t('login_success_window_closing'));
        setTimeout(() => window.close(), 1500);
    }

    await sendMsgToService({code, flowId, provider}, MsgType.X402EmbeddWalletSignIn)
}

function showStatus(statusTxt: string) {
    const status = document.getElementById("status") as HTMLElement | null;
    if (status) {
        status.innerText = statusTxt;
    }
}

async function init() {
    await initCDP()
    const user = await getCurrentUser();
    if (user) {
        showStatus(t('wallet_connected'))
        disableLoginButtons();
    }

    $Id("btn-google").onclick = () => signInFunc("google")
    $Id("btn-apple").onclick = () => signInFunc("apple")
    $Id("btn-x").onclick = () => signInFunc("x")
}

function disableLoginButtons() {
    ["btn-google", "btn-apple", "btn-x"].forEach(id => {
        const btn = document.getElementById(id) as HTMLButtonElement | null;
        if (btn) {
            btn.disabled = true;
            btn.style.opacity = "0.6";
            btn.style.cursor = "not-allowed";
        }
    });
}

function signInFunc(typ: OAuth2ProviderType) {
    signInWithOAuth(typ).then(() => {
        showStatus(t('redirecting_to_login', typ));
    }).catch(e => {
        showStatus(e.toString());
    });
}