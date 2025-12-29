import {getCurrentUser, signInWithOAuth, type OAuth2ProviderType, getAccessToken} from "@coinbase/cdp-core";
import {initCDP} from "../common/x402_obj";
import {sendMsgToService} from "../common/utils";
import {MsgType} from "../common/consts";
import {x402WorkerFetch} from "./common";

// 定义 UI 状态类型
type UIState = 'loading' | 'success' | 'error' | 'idle';

class AuthManager {
    private textEl = document.getElementById("statusText")!;
    private loaderEl = document.getElementById("loader")!;
    private btnRetry = document.getElementById("btnRetry") as HTMLButtonElement;

    /**
     * 统一更新 UI 状态
     */
    private updateUI(message: string, state: UIState = 'loading') {
        this.textEl.textContent = message;
        this.textEl.className = `status-text ${state}`;

        // 控制转圈圈
        this.loaderEl.style.display = (state === 'loading') ? "block" : "none";
        // 控制重试按钮
        this.btnRetry.classList.toggle("btn-hidden", state !== 'error');
    }

    private async handleCallback(params: URLSearchParams) {
        const code = params.get("code")!;
        const flowId = params.get("flow_id");
        const provider = (params.get("provider_type") || "x") as OAuth2ProviderType;

        this.updateUI("正在验证授权结果...");
        await initCDP();

        const user = await getCurrentUser()
        if (!user) {
            this.btnRetry.disabled = false;
            this.btnRetry.classList.remove("btn-hidden");
            return;
        }

        const accessToken = await getAccessToken();
        console.log("------>>> accessToken :", accessToken);

        this.updateUI("正在验证用户信息...");
        try {
            const validationResult = await x402WorkerFetch("/validate-token", {accessToken: accessToken})
            console.log("------>>> validation result:", validationResult);
        } catch (err) {
            console.error("Token 验证失败:", err);
        }

        await sendMsgToService({code, flowId, provider}, MsgType.X402EmbeddWalletSignIn);
        this.updateUI("✅ 登录成功，正在关闭...", "success");
        setTimeout(() => window.close(), 3_000);
    }

    public async run() {
        this.btnRetry.disabled = true;

        try {
            const params = new URLSearchParams(window.location.search);

            // 1. 如果 URL 带有 code，说明是 OAuth 回调
            if (params.has("code")) {
                await this.handleCallback(params);
                return;
            }

            // 2. 正常初始化流程
            this.updateUI("正在连接 Coinbase 服务...");
            await initCDP();

            // 3. 检查是否已登录
            const user = await getCurrentUser();
            if (user) {
                this.updateUI("✅ 已检测到连接，即将关闭...", "success");
                setTimeout(() => window.close(), 3_000);
                return;
            }

            // 4. 执行自动登录
            this.updateUI("正在跳转 X (Twitter) 登录...");
            signInWithOAuth("x").catch((err: Error) => {
                this.btnRetry.classList.remove("btn-hidden");
                throw err;
            });
        } catch (e: any) {
            console.error("Auth Error:", e);
            this.updateUI(`❌ 错误: ${e.message || "初始化失败"}`, "error");
        } finally {
            this.btnRetry.disabled = false;
        }
    }
}

// 初始化
document.addEventListener("DOMContentLoaded", () => {
    const manager = new AuthManager();

    document.getElementById("btnRetry")!.onclick = () => manager.run();
    document.getElementById("btnClose")!.onclick = () => window.close();

    manager.run();
});