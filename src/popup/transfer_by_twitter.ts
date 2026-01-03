import {initCDP, X402_FACILITATORS} from "../common/x402_obj";
import {isSignedIn} from "@coinbase/cdp-core";
import browser from "webextension-polyfill";
import {showPopupWindow} from "./common";
import {getChainId} from "../wallet/wallet_setting";
import {postToX402Srv} from "../wallet/cdp_wallet";
import {logX402} from "../common/debug_flags";
import {t} from "../common/i18n";

// --- 类型定义 ---
interface UserProfile {
    userName?: string;
    displayName?: string;
    userId?: string;
    avatar?: string;
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
        return {isValid: false, value: cleanValue, message: "请输入有效的金额（最多6位小数）"};
    }

    const num = parseFloat(cleanValue);
    if (isNaN(num) || num <= 0) {
        return {isValid: false, value: cleanValue, message: "金额必须大于 0"};
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
        UI.confirmText.textContent = "处理中...";
    } else {
        UI.confirmText.textContent = "确认转账";
    }
};

// --- 核心业务：转账桩函数 ---
async function performTransfer(profile: UserProfile, amount: string): Promise<void> {
    console.log(`[Transfer] To: ${profile.userId}, Amount: ${amount} USDC`);
    // 模拟异步操作
    await new Promise(resolve => setTimeout(resolve, 2000));
    const chainId = await getChainId();
    const end_point = X402_FACILITATORS[chainId].endpoint + "/user/transfer_by_twitter";

    const response = await postToX402Srv(end_point, {
        amount: amount,
        xId: profile.userId
    })
    const result = await response.json()
    if (!result.success || !result.txHash) {
        if (result.code === "RECIPIENT_NOT_FOUND") throw new Error(t('register_account_error'))
        throw new Error("failed create block chain tx， error=" + result)
    }
    const url = X402_FACILITATORS[chainId].browser + "/tx/" + result.txHash
    console.log("------>>>transfer success:", url, result.txHash)
    await browser.tabs.create({url});
    return result.txHash
}

// --- 初始化控制器 ---
async function init() {
    const profile = parseProfile();

    if (!profile) {
        updateUIState(false, "", "错误：无法加载用户信息，请重新打开。");
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
            updateUIState(false, "", "请先连接钱包。3秒后自动关闭该窗口");
            setTimeout(async () => {
                const url = browser.runtime.getURL("html/cdp_auth_auto_x.html");
                await showPopupWindow(url)
                window.close();
            }, 3_000)
            return;
        }
    } catch (e) {
        updateUIState(false, "", "服务初始化失败。");
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

        updateUIState(true, "正在请求钱包确认...");
        try {
            const hash = await performTransfer(profile, validation.value);
            updateUIState(true, "✅ 转账成功:" + hash);
            setTimeout(() => window.close(), 1_500);
        } catch (err: any) {
            updateUIState(false, "", err.message || "转账失败，请稍后重试");
        }
    });

    // 自动聚焦
    UI.amountInput.focus();
}

// 启动
document.addEventListener("DOMContentLoaded", init);