import {TcMessage} from "../common/msg_obj";

function postToContent(action: string, data?: unknown): void {
    const msg = new TcMessage(action, true, data);
    window.postMessage(msg, '*'); // structured clone，安全传对象
}

declare global {
    interface Window {
        ytHasPatchedFetch?: boolean;
        ytPatchedFetch?: any;
        ytHasPatchedXHR?: boolean;
        ytPatchedXHR?: any;
        ytExtraHooksInstalled?: boolean;
    }
}

function ytStartHookWatchdog(): void {
    const RECHECK_MS = 500;
    setInterval(() => {
        try {
            if ((window as any).fetch !== window.ytPatchedFetch) {
                console.warn("fetch hook lost, re-hooking...");
                window.ytHasPatchedFetch = false;
                ytInstallFetch();
            }
            if (window.XMLHttpRequest !== window.ytPatchedXHR) {
                console.warn("xhr hook lost, re-hooking...");
                window.ytHasPatchedXHR = false;
                ytInstallXHR();
            }
        } catch (e) {
            console.warn("watchdog error", e);
        }
    }, RECHECK_MS);
}


function ytInstallFetch(){
    if (window.ytHasPatchedFetch) {
        console.log("📺[youtube]✅fetch hook already installed");
        return;
    }

    const originalFetch = window.fetch;

    const patchedFetch = async function (
        this: any,
        input: RequestInfo | URL,
        init?: RequestInit
    ): Promise<Response> {
        try {
            return (originalFetch as any).call(this, input, init);
        }catch (e) {
            console.warn(` original fetch failed`, e);
            throw e;
        }
    };

    (window as any).fetch = patchedFetch as typeof window.fetch;
    window.ytHasPatchedFetch = true;
    window.ytPatchedFetch = patchedFetch;
    console.log("📺[youtube]✅ fetch hook installed");
}

function ytInstallXHR(){
    if (window.ytHasPatchedXHR) {
        console.log("📺[youtube]✅xhr hook already installed");
        return;
    }

    const OriginalXHR = window.XMLHttpRequest;
    class patchedXHR extends OriginalXHR {
        private ytUrl: string | null = null;

        open(method: string, url: string, async?: boolean, user?: string | null, password?: string | null) {
            this.ytUrl = url;
            return super.open(method, url, async ?? true, user ?? null, password ?? null);
        }

        send(...args: any[]): void {
            return (OriginalXHR.prototype.send as any).apply(this, args);
        }
    }

    // @ts-ignore
    window.XMLHttpRequest = patchedXHR;
    window.ytHasPatchedXHR = true;
    window.ytPatchedXHR = patchedXHR;
    console.log("📺[youtube]✅ xhr hook installed");
}

function initYtInjection(): void {
    if (window.ytExtraHooksInstalled) {
        console.log("hooks already installed");
        return;
    }

    console.log("installing hooks...");
    ytInstallFetch();
    ytInstallXHR();
    ytStartHookWatchdog();
    window.ytExtraHooksInstalled = true;
    console.log("📺[youtube]✅ hooks ready");
}

initYtInjection();
