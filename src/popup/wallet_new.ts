import {ethers} from "ethers";
import browser from "webextension-polyfill";
import {saveWallet} from "../wallet/obj";

const DERIVATION_PATH = "m/44'/60'/0'/0/0";

type Mode = "create" | "import";

let currentMode: Mode = "create";
let generatedMnemonic = "";

const modeCreateBtn = document.getElementById("mode-create") as HTMLButtonElement | null;
const modeImportBtn = document.getElementById("mode-import") as HTMLButtonElement | null;
const regenerateBtn = document.getElementById("btn-regenerate") as HTMLButtonElement | null;
const saveBtn = document.getElementById("btn-save-wallet") as HTMLButtonElement | null;
const mnemonicDisplay = document.getElementById("mnemonic-display") as HTMLTextAreaElement | null;
const mnemonicConfirmInput = document.getElementById("mnemonic-confirm") as HTMLTextAreaElement | null;
const mnemonicImportInput = document.getElementById("mnemonic-import") as HTMLTextAreaElement | null;
const passwordInput = document.getElementById("password-input") as HTMLInputElement | null;
const passwordConfirmInput = document.getElementById("password-confirm-input") as HTMLInputElement | null;
const backupCheckbox = document.getElementById("backup-confirmation") as HTMLInputElement | null;
const modeCreateSection = document.getElementById("mnemonic-display-section") as HTMLDivElement | null;
const modeImportSection = document.getElementById("mnemonic-import-section") as HTMLDivElement | null;
const statusMessage = document.getElementById("wallet-new-status") as HTMLDivElement | null;

function setStatus(message: string, isError = false) {
    if (!statusMessage) return;
    statusMessage.textContent = message;
    statusMessage.classList.toggle("error", isError);
}

async function generateMnemonic(): Promise<void> {
    generatedMnemonic = ethers.utils.entropyToMnemonic(ethers.utils.randomBytes(16));
    if (mnemonicDisplay) {
        mnemonicDisplay.value = generatedMnemonic;
    }
    if (mnemonicConfirmInput) {
        mnemonicConfirmInput.value = "";
    }
}

function updateMode(mode: Mode) {
    currentMode = mode;

    modeCreateBtn?.classList.toggle("active", mode === "create");
    modeImportBtn?.classList.toggle("active", mode === "import");

    if (modeCreateSection) {
        modeCreateSection.style.display = mode === "create" ? "block" : "none";
    }
    if (modeImportSection) {
        modeImportSection.style.display = mode === "import" ? "block" : "none";
    }
    if (saveBtn) {
        saveBtn.textContent = mode === "create" ? "创建并保存" : "导入并保存";
    }
    setStatus("");
}

async function ensureGeneratedMnemonic(): Promise<void> {
    if (!generatedMnemonic) {
        await generateMnemonic();
    }
}

async function handleSave(): Promise<void> {
    if (!passwordInput || !passwordConfirmInput || !backupCheckbox) return;

    if (saveBtn) {
        saveBtn.disabled = true;
    }
    setStatus("处理中，请稍候...");

    try {
        const password = passwordInput.value;
        const confirmPassword = passwordConfirmInput.value;

        if (!password || password.length < 8) {
            throw new Error("请输入至少 8 位的口令");
        }
        if (password !== confirmPassword) {
            throw new Error("两次输入的口令不一致");
        }
        if (!backupCheckbox.checked) {
            throw new Error("请先确认已备份助记词");
        }

        let mnemonic: string;
        if (currentMode === "create") {
            await ensureGeneratedMnemonic();
            mnemonic = generatedMnemonic;
            const confirmation = mnemonicConfirmInput?.value ?? "";
            const normalizedMnemonic = normalizeMnemonic(mnemonic);
            const normalizedConfirmation = normalizeMnemonic(confirmation);
            if (normalizedMnemonic !== normalizedConfirmation) {
                throw new Error("确认助记词与生成的不一致");
            }
            mnemonic = normalizedMnemonic;
        } else {
            mnemonic = mnemonicImportInput?.value?.trim() ?? "";
            if (!mnemonic) {
                throw new Error("请输入有效的助记词");
            }
            if (!ethers.utils.isValidMnemonic(mnemonic)) {
                throw new Error("助记词格式不正确");
            }
            mnemonic = normalizeMnemonic(mnemonic);
        }

        const wallet = ethers.Wallet.fromMnemonic(mnemonic, DERIVATION_PATH);
        const keystoreJson = await wallet.encrypt(password);

        await saveWallet({
            address: wallet.address,
            keystoreJson,
            createdAt: Date.now(),
        });

        const address = wallet.address;

        mnemonic = "";
        generatedMnemonic = "";
        destroySensitiveWalletData(wallet);

        passwordInput.value = "";
        passwordConfirmInput.value = "";
        mnemonicConfirmInput && (mnemonicConfirmInput.value = "");
        mnemonicImportInput && (mnemonicImportInput.value = "");
        backupCheckbox.checked = false;

        if (mnemonicDisplay) {
            mnemonicDisplay.value = "";
        }

        setStatus(`钱包已保存：${address}`);

        if (typeof chrome !== "undefined" && chrome?.runtime?.sendMessage) {
            chrome.runtime.sendMessage({type: "wallet:created", address});
        } else if (browser?.runtime?.sendMessage) {
            browser.runtime.sendMessage({type: "wallet:created", address});
        }
    } catch (error) {
        const message = (error as Error).message ?? "保存钱包时发生错误";
        setStatus(message, true);
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
        }
    }
}

async function init() {
    await ensureGeneratedMnemonic();
    updateMode("create");

    modeCreateBtn?.addEventListener("click", async () => {
        await ensureGeneratedMnemonic();
        updateMode("create");
    });
    modeImportBtn?.addEventListener("click", () => updateMode("import"));
    regenerateBtn?.addEventListener("click", () => generateMnemonic());
    saveBtn?.addEventListener("click", () => {
        handleSave().then();
    });
}

document.addEventListener("DOMContentLoaded", () => {
    init().then();
});

function normalizeMnemonic(phrase: string): string {
    if (!phrase) {
        return "";
    }
    return phrase.trim().split(/\s+/).join(" ");
}

function destroySensitiveWalletData(wallet: ethers.Wallet) {
    try {
        const signingKey = (wallet as any)._signingKey?.();
        if (signingKey && typeof signingKey === "object" && "privateKey" in signingKey) {
            signingKey.privateKey = "";
        }
    } catch (err) {
        // ignore cleanup errors silently
    }

    try {
        (wallet as any)._mnemonic = null;
    } catch (err) {
        // ignore cleanup errors silently
    }
}
