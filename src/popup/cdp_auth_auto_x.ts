import {getCurrentUser, signInWithOAuth, type OAuth2ProviderType, getAccessToken} from "@coinbase/cdp-core";
import {initCDP} from "../common/x402_obj";
import {sendMsgToService} from "../common/utils";
import {MsgType} from "../common/consts";
import {initI18n, t} from "../common/i18n";
import {x402WorkerFetch} from "../wallet/cdp_wallet";
import {getDevicePublicKeySpkiB64} from "../common/device_key";

type UIState = 'loading' | 'success' | 'error' | 'idle';
function translateAuto() {
    // 设置页面标题
    document.title = t('cdp_auth_page_title');
    // 设置页面标题
    const containerHeader = document.getElementById('container-title');
    if (containerHeader) {
        containerHeader.textContent = t('cdp_auth_page_title_header');
    }

    const ButtonClose = document.getElementById('btnClose');
    if (ButtonClose) {
        ButtonClose.textContent = t('cdp_auth_action_close');
    }
    const ButtonRetry = document.getElementById('btnRetry');
    if (ButtonRetry) {
        ButtonRetry.textContent = t('cdp_auth_action_retry');
    }

}

class AuthManager {
    private textEl = document.getElementById("statusText")!;
    private loaderEl = document.getElementById("loader")!;
    private btnRetry = document.getElementById("btnRetry") as HTMLButtonElement;

    private updateUI(message: string, state: UIState = 'loading') {
        this.textEl.textContent = message;
        this.textEl.className = `status-text ${state}`;
        this.loaderEl.style.display = (state === 'loading') ? "block" : "none";
        this.btnRetry.classList.toggle("btn-hidden", state !== 'error');
    }

    private async handleCallback(params: URLSearchParams) {
        const code = params.get("code")!;
        const flowId = params.get("flow_id");
        const provider = (params.get("provider_type") || "x") as OAuth2ProviderType;

        this.updateUI(t("cdp_auth_verifying_authorization_result"));
        await initCDP();

        const user = await getCurrentUser()
        if (!user) {
            this.btnRetry.disabled = false;
            this.btnRetry.classList.remove("btn-hidden");
            return;
        }

        const accessToken = await getAccessToken();
        this.updateUI(t("cdp_auth_verifying_user_info"));

        try {
            const devicePubkey = await getDevicePublicKeySpkiB64();
            const resp = await x402WorkerFetch("/validate-token", {accessToken: accessToken, device_pubkey: devicePubkey})
            console.log("------>>> validation result:", resp);
        } catch (err) {
            console.error(t("wallet_verify_failed"), err);
        }

        await sendMsgToService({code, flowId, provider}, MsgType.X402EmbeddWalletSignIn);
        this.updateUI(t("login_success_window_closing"), "success");
        setTimeout(() => window.close(), 3_000);
    }

    public async run() {
        this.btnRetry.disabled = true;

        try {
            const params = new URLSearchParams(window.location.search);

            if (params.has("code")) {
                await this.handleCallback(params);
                return;
            }

            this.updateUI(t("cdp_auth_connecting_coinbase_service"));
            await initCDP();

            const user = await getCurrentUser();
            if (user) {
                this.updateUI(t("cdp_auth_connection_detected_closing"), "success");
                setTimeout(() => window.close(), 3_000);
                return;
            }

            this.updateUI(t("cdp_auth_redirecting_to_x_login"));
            signInWithOAuth("x").catch((err: Error) => {
                this.btnRetry.classList.remove("btn-hidden");
                throw err;
            });

        } catch (e: any) {
            console.error("Auth Error:", e);
            this.updateUI(
                t("cdp_auth_error_with_detail", e?.message || t("initialization_failed")),
                "error"
            );
        } finally {
            this.btnRetry.disabled = false;
        }
    }
}

document.addEventListener("DOMContentLoaded", () => {
    const manager = new AuthManager();
    initI18n();
    translateAuto()

    document.getElementById("btnRetry")!.onclick = () => manager.run();
    document.getElementById("btnClose")!.onclick = () => window.close();

    manager.run().then();
});
