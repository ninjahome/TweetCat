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