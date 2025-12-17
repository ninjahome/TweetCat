// password_modal.ts
import {t} from "../common/i18n";
import {$Id, showAlert} from "./common";
import {sendMsgToService} from "../common/utils";
import {MsgType} from "../common/consts";

let modalEl: HTMLDivElement | null = null;
let inputEl: HTMLInputElement | null = null;
let cancelBtn: HTMLButtonElement | null = null;
let confirmBtn: HTMLButtonElement | null = null;

let currentResolver: ((value: string | null) => void) | null = null;
let initialized = false;

function ensureInitialized(promptMessage?:string): boolean {
    if (initialized) {
        return !!modalEl && !!inputEl && !!cancelBtn && !!confirmBtn;
    }

    modalEl = $Id("modal-password-dialog") as HTMLDivElement | null;
    inputEl = $Id("password-input") as HTMLInputElement | null;
    cancelBtn = $Id("btn-cancel-password") as HTMLButtonElement | null;
    confirmBtn = $Id("btn-confirm-password") as HTMLButtonElement | null;

    if (!modalEl || !inputEl || !cancelBtn || !confirmBtn) {
        console.warn("[password_modal] password modal DOM not found.");
        return false;
    }

    // 初始化文案（走 i18n）
    const titleEl = $Id("modal-password-title") as HTMLElement | null;
    if (titleEl) {
        titleEl.textContent = promptMessage ?? "Need Wallet Password";
    }
    inputEl.placeholder = t("ipfs_password_msg");
    cancelBtn.textContent = t("cancel");
    confirmBtn.textContent = t("confirm");
    confirmBtn.disabled = true;

    const closeWith = (value: string | null) => {
        hideModal();
        if (currentResolver) {
            const r = currentResolver;
            currentResolver = null;
            r(value);
        }
    };

    // 事件绑定（只绑一次）
    cancelBtn.addEventListener("click", () => {
        closeWith(null);
    });

    modalEl.addEventListener("click", (ev) => {
        if (ev.target === modalEl) {
            closeWith(null);
        }
    });

    confirmBtn.addEventListener("click", () => {
        if (!inputEl) return;
        const val = inputEl.value.trim();
        if (!val) return;
        closeWith(val);
    });

    inputEl.addEventListener("input", () => {
        if (!inputEl || !confirmBtn) return;
        confirmBtn.disabled = inputEl.value.trim().length === 0;
    });

    inputEl.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") {
            ev.preventDefault();
            if (!confirmBtn || confirmBtn.disabled || !inputEl) return;
            const val = inputEl.value.trim();
            if (!val) return;
            closeWith(val);
        } else if (ev.key === "Escape") {
            ev.preventDefault();
            closeWith(null);
        }
    });

    document.addEventListener("keydown", (ev) => {
        if (ev.key === "Escape" && modalEl && !modalEl.classList.contains("hidden")) {
            ev.preventDefault();
            closeWith(null);
        }
    });

    initialized = true;
    return true;
}

function showModal() {
    if (!modalEl || !inputEl || !confirmBtn) return;
    modalEl.classList.remove("hidden");
    document.body.classList.add("modal-open");
    inputEl.value = "";
    confirmBtn.disabled = true;
    window.setTimeout(() => {
        inputEl?.focus();
    }, 0);
}

function hideModal() {
    if (!modalEl) return;
    modalEl.classList.add("hidden");
    // 这里简单处理：如果你有别的 modal 管理，也可以只在「没有其他 modal 可见」时移除这个类
    document.body.classList.remove("modal-open");
}

export function openPasswordModal(promptMessage?:string): Promise<string | null> {
    if (!ensureInitialized(promptMessage)) {
        // 没有这几个 DOM 节点，直接返回 null
        return Promise.resolve(null);
    }

    showModal();

    return new Promise<string | null>((resolve) => {
        currentResolver = resolve;
    });
}



export async function requestPassword(promptMessage: string): Promise<string> {
    const input = await openPasswordModal(promptMessage);

    if (!input) {
        throw new Error(t("wallet_error_operation_cancelled"));
    }
    return input;
}