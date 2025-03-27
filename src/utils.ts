import browser from "webextension-polyfill";

export async function sendMsgToService(data: any, actTyp: string): Promise<any> {
    try {
        return await browser.runtime.sendMessage({
            action: actTyp,
            data: data,
        });
    } catch (e) {
        const error = e as Error;
        console.warn("------>>>send message error", error, data, actTyp);
        return {success: false, data: error.message}
    }
}

export function showView(hash: string, callback?: (hash: string) => void): void {
    const views = document.querySelectorAll<HTMLElement>('.page_view');
    views.forEach(view => view.style.display = 'none');

    const id = hash.replace('#onboarding/', 'view-');
    const targetView = document.getElementById(id);
    if (targetView) {
        targetView.style.display = 'block';
    } else {
        console.log("------>>> failed to find view for router hash:", hash);
    }
    if (callback) {
        callback(hash);
    }
}

export function addCustomStyles(cssFilePath: string): void {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.type = 'text/css';
    link.href = browser.runtime.getURL(cssFilePath);
    document.head.appendChild(link);
}

export function isTwitterUserProfile(): string | null {
    const path = window.location.pathname;
    const match = path.match(/^\/([a-zA-Z0-9_]+)$/);
    const excludedPaths = ['home', 'explore', 'notifications', 'messages', 'settings', 'login', 'signup'];

    // 先检查 URL 是否有效且不在排除列表中
    if (!match || excludedPaths.includes(match[1])) {
        return null;
    }
    return match[1];
    // 再检查页面元素
    // return !!document.querySelector('[data-testid="UserProfileHeader_Items"]');
}