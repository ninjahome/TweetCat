import {EncryptedBlock, IpfsProvider, IpfsSettings, PROVIDER_TYPE_TWEETCAT} from "../wallet/ipfs_settings";
import {t} from "../common/i18n";

let notificationTimer: number | null = null;
let notificationBar: HTMLDivElement | null = null;

export function showNotification(message: string, type: "info" | "error" = "info", duration = 4000) {
    if (!notificationBar) notificationBar = document.getElementById("notification") as HTMLDivElement | null;

    if (!notificationBar) return;
    notificationBar.textContent = message;
    notificationBar.classList.remove("hidden", "info", "error");
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
    notificationBar.classList.remove("info", "error");
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
