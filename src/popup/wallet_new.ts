// src/popup/wallet_new.ts
import browser from "webextension-polyfill";
import {generateMnemonic, saveFromMnemonic} from "../wallet/wallet_api";
import {hideLoading, showLoading} from "./common";
import { t } from "../common/i18n";


type Mode = "create" | "import" | null;

let currentMode: Mode = null;
let generated = "";

function qs<T extends HTMLElement = HTMLElement>(sel: string): T {
    const el = document.querySelector(sel) as T | null;
    if (!el) throw new Error(`Missing element: ${sel}`);
    return el;
}

function hide(...ids: string[]) {
    ids.forEach(id => qs(id).classList.add("hidden"));
}

function show(...ids: string[]) {
    ids.forEach(id => qs(id).classList.remove("hidden"));
}

async function onLoad() {
    goIntro();

    // 选择模式
    qs<HTMLButtonElement>("#btn-go-create").addEventListener("click", async () => {
        currentMode = "create";
        hide("#step-intro");
        show("#step-generate");
        await regenerate();
    });
    qs<HTMLButtonElement>("#btn-go-import").addEventListener("click", () => {
        currentMode = "import";
        hide("#step-intro");
        show("#step-import");
    });

    // 生成/显示隐藏
    qs<HTMLButtonElement>("#btn-regenerate").addEventListener("click", regenerate);
    let hiddenFlag = false;
    qs<HTMLButtonElement>("#btn-toggle-mnemonic").addEventListener("click", () => {
        const el = qs<HTMLTextAreaElement>("#mnemonic-generated");
        hiddenFlag = !hiddenFlag;
        el.style.filter = hiddenFlag ? "blur(6px)" : "none";
        qs("#btn-toggle-mnemonic").textContent = hiddenFlag ? t("wallet_new_show") : t("wallet_new_hide");
    });

    // 步进
    qs<HTMLButtonElement>("#btn-next-to-create-confirm").addEventListener("click", () => {
        hide("#step-generate");
        show("#step-create-confirm");
    });
    qs<HTMLButtonElement>("#btn-back-from-generate").addEventListener("click", goIntro);

    qs<HTMLButtonElement>("#btn-next-to-password").addEventListener("click", () => {
        const input = qs<HTMLTextAreaElement>("#mnemonic-confirm").value.trim().replace(/\s+/g, " ");
        const backed = (qs<HTMLInputElement>("#checkbox-backed-up")).checked;
        const s = qs("#confirm-status");
        s.textContent = "";
        s.classList.remove("error");
        if (!input) {
            s.textContent = t('wallet_new_mnemonic_incomplete');
            s.classList.add("error");
            return;
        }
        if (input !== generated.trim().replace(/\s+/g, " ")) {
            s.textContent = t('wallet_new_mnemonic_mismatch');
            s.classList.add("error");
            return;
        }
        if (!backed) {
            s.textContent = t('wallet_new_backup_checkbox_required');
            s.classList.add("error");
            return;
        }
        hide("#step-create-confirm");
        show("#step-password");
    });
    qs<HTMLButtonElement>("#btn-back-from-confirm").addEventListener("click", () => {
        hide("#step-create-confirm");
        show("#step-generate");
    });

    qs<HTMLButtonElement>("#btn-next-import-password").addEventListener("click", () => {
        const m = qs<HTMLTextAreaElement>("#mnemonic-import").value.trim().replace(/\s+/g, " ");
        const s = qs("#import-status");
        s.textContent = "";
        s.classList.remove("error");
        if (!m) {
            s.textContent = t('wallet_new_mnemonic_placeholder');
            s.classList.add("error");
            return;
        }
        generated = m;
        hide("#step-import");
        show("#step-password");
    });
    qs<HTMLButtonElement>("#btn-back-from-import").addEventListener("click", goIntro);

    qs<HTMLButtonElement>("#btn-save-wallet").addEventListener("click", saveWalletFlow);
    qs<HTMLButtonElement>("#btn-back-from-password").addEventListener("click", () => {
        hide("#step-password");
        show(currentMode === "create" ? "#step-create-confirm" : "#step-import");
    });

    qs<HTMLButtonElement>("#btn-go-dashboard").addEventListener("click", async () => {
        const currentTab = await browser.tabs.getCurrent();
        if (currentTab && currentTab.id) await browser.tabs.remove(currentTab.id);
    });
}

async function regenerate() {
    const out = qs<HTMLTextAreaElement>("#mnemonic-generated");
    const s = qs("#gen-status");
    s.textContent = "";
    s.classList.remove("error");
    try {
        generated = await generateMnemonic(12);
        out.value = generated;
    } catch (e: any) {
        s.textContent = e?.message || t('wallet_new_generate_failed');
        s.classList.add("error");
    }
}

async function saveWalletFlow() {
    const p1 = (qs<HTMLInputElement>("#password-input")).value || "";
    const p2 = (qs<HTMLInputElement>("#password-confirm-input")).value || "";
    const s = qs("#password-status");
    s.textContent = "";
    s.classList.remove("error");
    if (p1.length < 8) {
        s.textContent = t('wallet_new_password_too_short');
        s.classList.add("error");
        return;
    }
    if (p1 !== p2) {
        s.textContent = t('wallet_new_password_mismatch');
        s.classList.add("error");
        return;
    }

    showLoading(t('wallet_creating_status'))

    try {
        await saveFromMnemonic(generated, p1);
        hide("#step-password");
        show("#step-success");
    } catch (e: any) {
        s.textContent = e?.message || t('wallet_new_save_failed');
        s.classList.add("error");
    } finally {
        hideLoading();
    }
}

function goIntro() {
    ["#step-intro", "#step-generate", "#step-create-confirm", "#step-password", "#step-import", "#step-success"]
        .forEach(h => qs(h).classList.add("hidden"));
    show("#step-intro");
    currentMode = null;
}

document.addEventListener("DOMContentLoaded", onLoad);
