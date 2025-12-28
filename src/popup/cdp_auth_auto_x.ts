import { getCurrentUser, signInWithOAuth, type OAuth2ProviderType } from "@coinbase/cdp-core";
import { initCDP } from "../common/x402_obj";
import { sendMsgToService } from "../common/utils";
import { MsgType } from "../common/consts";

type StatusKind = "default" | "error" | "success";

const AUTO_PROVIDER: OAuth2ProviderType = "x";



function setBadge(text: string) {
    const badgeText = document.getElementById("badgeText");
    if (badgeText) badgeText.textContent = text;
}

function setStatus(message: string, kind: StatusKind = "default") {
    const statusEl = document.getElementById("status");
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.classList.remove("error", "success");
    if (kind === "error") statusEl.classList.add("error");
    if (kind === "success") statusEl.classList.add("success");
}

function showLoading(show: boolean) {
    const loadingEl = document.getElementById("loading");
    if (!loadingEl) return;
    loadingEl.style.display = show ? "block" : "none";
}

function showBtn(id: "btnRetry" | "btnClose", show: boolean, label?: string) {
    const btn = document.getElementById(id) as HTMLButtonElement | null;
    if (!btn) return;
    btn.classList.toggle("btn-hidden", !show);
    if (label) btn.textContent = label;
}

function disableBtn(id: "btnRetry" | "btnClose", disabled: boolean) {
    const btn = document.getElementById(id) as HTMLButtonElement | null;
    if (!btn) return;
    btn.disabled = disabled;
    btn.style.opacity = disabled ? "0.7" : "1";
    btn.style.cursor = disabled ? "not-allowed" : "pointer";
}

function sleep(ms: number) {
    return new Promise<void>((r) => setTimeout(r, ms));
}

async function withTimeout<T>(p: Promise<T>, ms: number, timeoutMsg: string): Promise<T> {
    let t: number | undefined;
    const timeout = new Promise<never>((_, rej) => {
        t = window.setTimeout(() => rej(new Error(timeoutMsg)), ms);
    });
    try {
        return await Promise.race([p, timeout]);
    } finally {
        if (t) window.clearTimeout(t);
    }
}

function safeCloseSoon(delayMs = 1200) {
    // window.close 有时会被浏览器策略阻止：我们仍然尝试，并同时展示“关闭”按钮兜底
    showBtn("btnClose", true, "关闭");
    setTimeout(() => {
        try {
            window.close();
        } catch {
            // ignore
        }
    }, delayMs);
}

function parseCallbackParams() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const flowId = params.get("flow_id");
    const provider = params.get("provider_type");
    if (code && provider) return { code, flowId, provider };
    return null;
}

async function handleOAuthCallback(code: string, flowId: string | null, provider: string) {
    setBadge("回调处理中");
    showLoading(true);
    setStatus("✅ 登录完成，正在完成连接...\n请不要关闭窗口", "default");

    // callback 场景也要确保 initCDP OK
    await withTimeout(initCDP(), 20000, "initCDP 超时（callback）");

    // 发消息给 service worker / background 做绑定、落库等
    await sendMsgToService({ code, flowId, provider }, MsgType.X402EmbeddWalletSignIn);

    // 再确认一次当前用户态（可选，但能让提示更稳）
    const user = await getCurrentUser();
    if (user) {
        setBadge("已连接");
        setStatus("✅ 登录成功，窗口即将关闭", "success");
    } else {
        // 不强依赖 user 必须存在：避免因为 getCurrentUser 偶发异常而卡死
        setBadge("已完成");
        setStatus("✅ 已完成连接，窗口即将关闭", "success");
    }

    showLoading(false);
    safeCloseSoon(900);
}

async function autoSignInX() {
    setBadge("准备跳转");
    setStatus("✅ 初始化成功\n正在跳转到 X 登录授权...", "default");
    showLoading(true);

    // 给 UI 一点时间刷新，再触发跳转
    await sleep(250);

    try {
        // signInWithOAuth 通常会触发页面跳转；这里用 void 避免“未处理的 Promise”噪音
        void signInWithOAuth(AUTO_PROVIDER);
        // 如果它不跳（极少数情况），用户也能看到这条提示
        await sleep(1200);
        setBadge("等待授权");
        setStatus("⏳ 正在等待 X 授权页面...\n如果没有自动跳转，请点击“重试”。", "default");
        showBtn("btnRetry", true, "重试登录");
    } catch (e: any) {
        setBadge("跳转失败");
        setStatus(`❌ 自动跳转失败：${String(e?.message ?? e)}\n请点击“重试”。`, "error");
        showLoading(false);
        showBtn("btnRetry", true, "重试登录");
        showBtn("btnClose", true, "关闭");
    }
}

async function runFlow() {
    showBtn("btnRetry", false);
    showBtn("btnClose", false);
    disableBtn("btnRetry", true);
    setBadge("初始化中");
    showLoading(true);
    setStatus("正在初始化 Coinbase CDP...", "default");

    try {
        // 1) 先处理 OAuth 回调
        const cb = parseCallbackParams();
        if (cb) {
            await handleOAuthCallback(cb.code, cb.flowId, cb.provider);
            return;
        }

        // 2) 普通进入：initCDP
        await withTimeout(initCDP(), 20000, "initCDP 超时");

        // 3) 如果已经登录过，直接提示并关窗
        const user = await getCurrentUser();
        if (user) {
            setBadge("已登录");
            showLoading(false);
            setStatus("✅ 已检测到你已登录/已连接钱包\n窗口即将关闭", "success");
            safeCloseSoon(900);
            return;
        }

        // 4) 未登录：自动用 X 登录
        await autoSignInX();
    } catch (e: any) {
        setBadge("初始化失败");
        showLoading(false);

        const msg = String(e?.message ?? e ?? "unknown error");
        setStatus(`❌ 初始化失败：${msg}\n请点击“重试初始化”。`, "error");

        showBtn("btnRetry", true, "重试初始化");
        showBtn("btnClose", true, "关闭");
        disableBtn("btnRetry", false);
    }
}

document.addEventListener("DOMContentLoaded", () => {
    // buttons
    const btnRetry = document.getElementById("btnRetry") as HTMLButtonElement | null;
    const btnClose = document.getElementById("btnClose") as HTMLButtonElement | null;

    if (btnRetry) {
        btnRetry.onclick = async () => {
            disableBtn("btnRetry", true);
            await runFlow();
        };
    }
    if (btnClose) {
        btnClose.onclick = () => window.close();
    }

    // start
    void runFlow();
});
