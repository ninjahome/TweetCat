import {getCurrentUser, signInWithOAuth} from "@coinbase/cdp-core";
import {sendMsgToService} from "../common/utils";
import {MsgType} from "../common/consts";
import {initCDP} from "../common/x402_obj";

document.addEventListener("DOMContentLoaded", initDashBoard as EventListener);

async function initDashBoard(): Promise<void> {
    try {
        // ① 判断是否是 OAuth 回调
        const params = new URLSearchParams(window.location.search);
        const code = params.get("code");
        const flowId = params.get("flow_id");
        const provider = params.get("provider_type");

        if (code && provider) {
            // ✅ OAuth 回调页：只做“结果接收”，不初始化 SDK
            await handleOAuthCallback(code, flowId, provider);
            return;
        }

        // ② 普通登录入口页：才初始化 SDK
        await init();

    } catch (err) {
        console.error(err);
        document.body.innerText = "初始化失败";
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
        return;
    }
    bind();
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

function bind() {
    document.getElementById("btn-google")?.addEventListener("click", () => {
        signInWithOAuth("google").then(() => {
            showStatus("正在跳转到 Google 登录...")
        });
    });
    document.getElementById("btn-apple")?.addEventListener("click", () => {
        signInWithOAuth("apple").then(() => {
            showStatus("正在跳转到 Apple 登录...")
        });
    });
    document.getElementById("btn-x")?.addEventListener("click", () => {
        signInWithOAuth("x").then(() => {
            showStatus("正在跳转到 X 登录...")
        });
    });
}
