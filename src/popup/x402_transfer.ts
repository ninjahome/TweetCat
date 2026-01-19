import {initCDP} from "../common/x402_obj";
import {isSignedIn} from "@coinbase/cdp-core";
import browser from "webextension-polyfill";
import {openTxInExplorer, showPopupWindow} from "./common";
import {postToX402SrvByPri} from "../wallet/cdp_wallet";
import {initI18n, t} from "../common/i18n";
import {logX402} from "../common/debug_flags";

// --- 类型定义 ---
interface UserProfile {
    userName?: string;
    displayName?: string;
    userId?: string;
    avatar?: string;
}

function safeStringify(v: any): string {
    try {
        if (typeof v === "string") return v;
        return JSON.stringify(v);
    } catch {
        return String(v);
    }
}

interface ValidationResult {
    isValid: boolean;
    value: string;
    message?: string;
}

// --- 常量与 UI 元素引用 ---
const UI = {
    amountInput: document.getElementById("js-amount") as HTMLInputElement,
    confirmBtn: document.getElementById("js-confirm") as HTMLButtonElement,
    confirmText: document.getElementById("js-confirm-text") as HTMLElement,
    errorMsg: document.getElementById("js-error") as HTMLElement,
    statusMsg: document.getElementById("js-status") as HTMLElement,
    avatar: document.getElementById("js-avatar") as HTMLImageElement,
    displayName: document.getElementById("js-display-name") as HTMLElement,
    userHandle: document.getElementById("js-user-handle") as HTMLElement,
    closeBtns: [document.getElementById("js-close"), document.getElementById("js-cancel")],
    presetBtns: document.querySelectorAll("[data-amt]")
};

function translateStaticTexts() {
    // 设置页面标题
    document.title = t('page_title_transfer');
    // 设置页面标题
    const pageHeader = document.getElementById('pageHeader');
    if (pageHeader) {
        pageHeader.textContent = t('page_header_transfer');
    }

    const decimalsHint = document.getElementById('js-decimals-hint');
    if (decimalsHint) {
        decimalsHint.textContent = t('x402_transfer_decimals_hint');
    }
    const labelUsdc = document.getElementById('js-label-usdc');
    if (labelUsdc) {
        labelUsdc.textContent = t('x402_usdt_balance_title');
    }
    const maxHint = document.getElementById('js-max-amount_transfor') as HTMLSpanElement | null;
    if (maxHint) {
        const max = maxHint.dataset.max || '100.00';
        maxHint.textContent = `${t('x402_transfer_hint_max_balance_prefix')}${max}(${t('currency_unit')})`;
    }

    const cancelBtn = document.getElementById('js-cancel');
    if (cancelBtn) cancelBtn.textContent = t('cancel');
    const confirmText = document.getElementById('js-confirm-text');
    if (confirmText) confirmText.textContent = t('x402_transfer_confirm');

}

// --- 工具函数 ---
const getQueryParam = (name: string): string | null =>
    new URLSearchParams(window.location.search).get(name);

const parseProfile = (): UserProfile | null => {
    const raw = getQueryParam("payload");
    if (!raw) return null;
    try {
        return JSON.parse(decodeURIComponent(raw));
    } catch (e) {
        return null;
    }
};

// --- 业务逻辑：校验 ---
const validateAmount = (raw: string): ValidationResult => {
    const cleanValue = raw.trim().replace(/,/g, "").replace(/^0+(?=\d)/, "") || (raw.startsWith(".") ? "0" + raw : raw);

    if (!cleanValue) return {isValid: false, value: "", message: ""}; // 初始状态不显报错
    if (!/^\d*(\.\d{0,6})?$/.test(cleanValue)) {
        return {
            isValid: false,
            value: cleanValue,
            message: t("x402_transfer_amount_max_decimals_6") // 或者你更细分一个 key
        };
    }

    const num = parseFloat(cleanValue);
    if (isNaN(num) || num <= 0) {
        return {
            isValid: false,
            value: cleanValue,
            message: t("x402_transfer_amount_gt0")
        };
    }

    return {isValid: true, value: cleanValue};
};

// --- 业务逻辑：状态更新 ---
const updateUIState = (loading: boolean, status?: string, error?: string) => {
    UI.confirmBtn.disabled = loading;
    UI.confirmBtn.parentElement?.classList.toggle("loading", loading);
    UI.statusMsg.textContent = status || "";
    UI.errorMsg.textContent = error || "";

    if (loading) {
        UI.confirmText.textContent = t('processing');
    } else {
        UI.confirmText.textContent = t('x402_transfer_confirm');
    }
};

// --- 核心业务：转账桩函数 ---
async function performTransfer(profile: UserProfile, amount: string): Promise<void> {
    logX402(`[Transfer] To: ${profile.userId}, Amount: ${amount} USDC`);
    const result = await postToX402SrvByPri("/user/transfer_by_twitter", {
        amount: amount,
        xId: profile.userId
    })

    if (!result.success || !result.txHash) {
        if (result.code === "RECIPIENT_NOT_FOUND") {
            throw new Error(t("register_account_error"));
        }
        throw new Error(t('transfer_create_tx_failed') + safeStringify(result));
    }

    logX402("------>>>transfer success:", result.txHash)
    await openTxInExplorer(result.txHash)
    return result.txHash
}

// --- 初始化控制器 ---
async function init() {
    initI18n();
    translateStaticTexts();
    const profile = parseProfile();

    if (!profile) {
        updateUIState(false, "", t("x402_transfer_profile_load_failed"));
        UI.confirmBtn.disabled = true;
        return;
    }

    // 填充用户信息
    UI.displayName.textContent = profile.displayName || "Unknown";
    UI.userHandle.textContent = profile.userName ? `@${profile.userName}` : "";
    if (profile.avatar) UI.avatar.src = profile.avatar;

    // 初始化 CDP
    try {
        await initCDP();
        const loggedIn = await isSignedIn();
        if (!loggedIn) {
            updateUIState(false, "", t("x402_transfer_wallet_required_auto_close"));
            setTimeout(async () => {
                const url = browser.runtime.getURL("html/cdp_auth_auto_x.html");
                await showPopupWindow(url)
                window.close();
            }, 3_000)
            return;
        }
    } catch (e) {
        updateUIState(false, "", t("initialization_failed"));
    }

    // 事件绑定：输入校验
    UI.amountInput.addEventListener("input", () => {
        const result = validateAmount(UI.amountInput.value);
        UI.errorMsg.textContent = result.message || "";
        UI.confirmBtn.disabled = !result.isValid;
    });

    // 事件绑定：预设金额
    UI.presetBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            UI.amountInput.value = btn.getAttribute("data-amt") || "";
            UI.amountInput.dispatchEvent(new Event("input"));
            UI.amountInput.focus();
        });
    });

    // 事件绑定：关闭/取消
    UI.closeBtns.forEach(btn => btn?.addEventListener("click", () => window.close()));

    // 事件绑定：提交转账
    UI.confirmBtn.addEventListener("click", async () => {
        const validation = validateAmount(UI.amountInput.value);
        if (!validation.isValid) return;

        updateUIState(true, t("x402_transfer_request_wallet_confirm"));
        try {
            const hash = await performTransfer(profile, validation.value);
            updateUIState(true, "✅ 转账成功:" + hash);
            setTimeout(() => window.close(), 1_500);
        } catch (err: any) {
            updateUIState(false, "", err.message || t("wallet_transfer_failed"));
        }
    });

    // 自动聚焦
    UI.amountInput.focus();
}

// 启动
document.addEventListener("DOMContentLoaded", init);