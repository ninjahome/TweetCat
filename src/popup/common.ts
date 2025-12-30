import {t} from "../common/i18n";
import browser from "webextension-polyfill";
import {getChainId} from "../wallet/wallet_setting";
import {X402_FACILITATORS} from "../common/x402_obj";
import {logX402} from "../common/debug_flags";

let notificationTimer: number | null = null;
let notificationBar: HTMLDivElement | null = null;

export function showNotification(message: string, type: "info" | "error" | "success" = "info", duration = 4000) {
    if (!notificationBar) notificationBar = document.getElementById("notification") as HTMLDivElement | null;

    if (!notificationBar) return;
    notificationBar.textContent = message;
    notificationBar.classList.remove("hidden", "info", "error", "success");
    notificationBar.classList.add(type);
    if (notificationTimer) {
        window.clearTimeout(notificationTimer);
        notificationTimer = null;
    }
    if (duration > 0 && message) {
        notificationTimer = window.setTimeout(() => {
            hideNotification();
        }, duration);
    }
}

export function hideNotification() {
    if (!notificationBar) notificationBar = document.getElementById("notification") as HTMLDivElement | null;

    if (!notificationBar) return;

    notificationBar.textContent = "";
    notificationBar.classList.add("hidden");
    notificationBar.classList.remove("info", "error", "success");
    if (notificationTimer) {
        window.clearTimeout(notificationTimer);
        notificationTimer = null;
    }
}

export function showLoading(msg: string = "") {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
        overlay.style.display = 'flex';
    }
    if (!msg) return
    overlay.querySelector(".loading-message").textContent = msg;
}

export function hideLoading() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
        overlay.style.display = 'none';
    }
}

export function $Id(id: string) {
    return document.getElementById(id) as HTMLElement | null;
}

export function $(sel: string) {
    return document.querySelector(sel) as HTMLElement | null;
}

export function $input(sel: string) {
    return document.querySelector(sel) as HTMLInputElement | null;
}

export function showAlert(title: string, message: string) {
    const alertBox = $Id('custom-alert');
    const alertTitle = $Id('alert-title');
    const alertMessage = $Id('alert-message');
    const alertOk = $Id('alert-ok');

    if (!alertBox || !alertTitle || !alertMessage || !alertOk) {
        console.error('Alert elements not found.');
        return;
    }

    // 设置标题和消息
    alertTitle.textContent = title;
    alertMessage.textContent = message;
    alertOk.textContent = t('ok');

    // 显示弹窗
    alertBox.style.display = 'block';

    // 按下 OK 按钮后隐藏
    alertOk.onclick = () => {
        alertBox.style.display = 'none';
    };
}

export function showConfirm(msg: string): Promise<boolean> {
    return new Promise((resolve) => {
        const container = document.getElementById("confirm-popup")!;
        container.style.display = 'block';

        (container.querySelector(".confirm-message") as HTMLElement).innerText = msg;

        const cancelBtn = container.querySelector(".btn-cancel") as HTMLElement;
        cancelBtn.innerText = t("cancel");
        cancelBtn.onclick = () => {
            container.style.display = 'none';
            resolve(false);
        };

        const okBtn = container.querySelector(".btn-ok") as HTMLElement;
        okBtn.innerText = t("confirm");
        okBtn.onclick = () => {
            container.style.display = 'none';
            resolve(true);
        };
    });
}


export async function showPopupWindow(url: string, width: number = 450, height: number = 650) {

    const currentWindow = await browser.windows.getLastFocused();

    let left = 0;
    let top = 0;

    if (currentWindow.width && currentWindow.height) {
        left = Math.round(currentWindow.left! + (currentWindow.width - width) / 2);
        top = Math.round(currentWindow.top! + (currentWindow.height - height) / 2);
    }

    await browser.windows.create({
        url,
        type: 'popup',
        width,
        height,
        left,
        top,
        focused: true
    });
}


export const FIXED_ETH_TRANSFER_GAS_ETH = 0.000002; // ETH转账所需Gas费
export const FIXED_MINI_USDC_TRANSFER = 0.00001; // USDC转账所需Gas费


export async function x402WorkerFetch(path: string, body: any): Promise<any> {
    const chainID = await getChainId()
    const url = X402_FACILITATORS[chainID].endpoint + path

    logX402("------>>> url:", url)
    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`x402worker fetch failed: ${response.status} - ${errorData}`);
    }

    return await response.json();
}

export async function x402WorkerGet(path: string, params?: Record<string, string>): Promise<any> {
    const chainID = await getChainId()
    let url = X402_FACILITATORS[chainID].endpoint + path
    
    if (params) {
        const searchParams = new URLSearchParams(params);
        url += "?" + searchParams.toString();
    }

    logX402("------>>> GET url:", url)
    const response = await fetch(url, {
        method: "GET",
        headers: {
            "Content-Type": "application/json",
        },
    });

    if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`x402worker GET failed: ${response.status} - ${errorData}`);
    }

    return await response.json();
}