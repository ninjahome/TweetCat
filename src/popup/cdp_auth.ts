import {getCurrentUser, OAuth2ProviderType, signInWithOAuth} from "@coinbase/cdp-core";
import {sendMsgToService} from "../common/utils";
import {MsgType} from "../common/consts";
import {initCDP} from "../common/x402_obj";
import {$Id, hideLoading, showLoading} from "./common";

document.addEventListener("DOMContentLoaded", initDashBoard as EventListener);

async function initDashBoard(): Promise<void> {
    showLoading("初始化 coinbase 钱包SDK")
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
        document.body.innerText = "初始化失败";
    } finally {
        hideLoading();
    }
}

async function handleOAuthCallback(
    code: string,
    flowId: string | null,
    provider: string,
) {
    showStatus("登录成功，正在完成连接…");

    await initCDP()

    const user = await getCurrentUser();
    if (user) {
        showStatus("登录成功！窗口即将关闭...");
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
        showStatus("钱包已连接")
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
        showStatus("正在跳转到 " + typ + " 登录...")
    }).catch(e => {
        showStatus(e.toString())
    });
}
