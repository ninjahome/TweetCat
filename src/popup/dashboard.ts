import browser from "webextension-polyfill";
import {ethers} from "ethers";
import {__DBK_AD_Block_Key, MsgType} from "../common/consts";
import {__tableCategory, checkAndInitDatabase, databaseAddItem} from "../common/database";
import {showView} from "../common/utils";
import {loadCategories} from "../object/category";
import {hideLoading, showAlert, showLoading} from "./dash_common";
import {sendMessageToX} from "../service_work/bg_msg";
import {localGet, localSet} from "../common/local_storage";
import {Category} from "../object/category";
import {getSystemSetting, switchAdOn} from "../object/system_setting";
import {initI18n, t} from "../common/i18n";
import {
    defaultWalletSettings,
    loadWallet,
    loadWalletSettings,
    saveWalletSettings,
    TCWallet,
    WalletSettings
} from "../wallet/obj";

const ARBITRUM_CHAIN_ID = 42161;
const DEFAULT_RPC_URL = "https://arb1.arbitrum.io/rpc";
const USDT_CONTRACT_ADDRESS = "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9";
const ERC20_ABI = [
    "function balanceOf(address owner) view returns (uint256)",
    "function transfer(address to, uint256 amount) returns (bool)"
];

type PasswordPrompt = () => Promise<string>;

let currentWallet: TCWallet | null = null;
let currentSettings: WalletSettings = {...defaultWalletSettings};
let walletControlsInitialized = false;

console.log('------>>>Happy developing ✨')
document.addEventListener("DOMContentLoaded", initDashBoard as EventListener);

let routeTarget = "";

async function initDashBoard(): Promise<void> {
    initI18n();
    await checkAndInitDatabase();
    if (routeTarget) {
        showView(routeTarget, dashRouter);
    } else {
        showView('#onboarding/main-home', dashRouter);
    }

    initCatMgmBtn();
    initNewCatModalDialog();
    initSettings();
    await initWalletOrCreate();
}

function dashRouter(path: string): void {
    // console.log("------>>> show view for path:", path);
    if (path === '#onboarding/main-home') {
        setHomeStatus().then();
    } else if (path === '#onboarding/category-manager') {
    }
}

function initCatMgmBtn() {
    const mgnCategoryBtn = document.getElementById("btn-mgn-category") as HTMLElement;
    mgnCategoryBtn.innerText = t('manage_category');
    mgnCategoryBtn.onclick = async () => {
        await browser.tabs.create({
            url: browser.runtime.getURL("html/following_mgm.html"),
        })
    }
}

function initNewCatModalDialog() {
    const cancelBtn = document.getElementById("btn-cancel-new-category") as HTMLElement;
    const confirmBtn = document.getElementById("btn-confirm-new-category") as HTMLElement;
    const modalDialog = document.getElementById("modal-add-category") as HTMLElement
    (modalDialog.querySelector("h3") as HTMLElement).innerText = t('add_new_category');
    cancelBtn.innerText = t('cancel');
    confirmBtn.innerText = t('confirm');
    (modalDialog.querySelector(".new-category-name") as HTMLInputElement).placeholder = t('enter_category_name');

    cancelBtn.addEventListener('click', () => modalDialog.style.display = 'none');
    confirmBtn.addEventListener('click', addNewCategory);
}

async function addNewCategory() {

    const modalDialog = document.getElementById("modal-add-category") as HTMLElement;
    const newCatInput = modalDialog.querySelector(".new-category-name") as HTMLInputElement;

    const newCatStr = newCatInput.value;
    if (!newCatStr) {
        showAlert(t('tips_title'), t('invalid_category_name'));
        return;
    }

    showLoading()
    const item = new Category(newCatStr);
    delete item.id;
    const newID = await databaseAddItem(__tableCategory, item);
    if (!newID) {
        showAlert(t('tips_title'), t('add_category_failed', newCatStr));
        hideLoading();
        return;
    }

    item.id = newID as number;
    await setHomeStatus();
    modalDialog.style.display = 'none'
    newCatInput.value = '';

    const changedCat = await loadCategories();
    await sendMessageToX(MsgType.CategoryChanged, changedCat, false);
    hideLoading();
    showAlert(t('tips_title'), t('save_success'));
}

async function setHomeStatus() {
    const isEnabled: boolean = await localGet(__DBK_AD_Block_Key) as boolean ?? false//TODO:: refactor __DBK_AD_Block_Key logic
    const blockAdsToggle = document.getElementById('ad-block-toggle') as HTMLInputElement;
    blockAdsToggle.checked = isEnabled;

    const adNumber = document.querySelector(".number-blocked-txt") as HTMLSpanElement;
    (document.querySelector(".ads-blocked-tips") as HTMLSpanElement).innerText = t('block_ads');
    const setting = await getSystemSetting();
    adNumber.innerText = "" + setting.adsBlocked
}


function initSettings() {
    const blockAdsToggle = document.getElementById('ad-block-toggle') as HTMLInputElement;

    blockAdsToggle.onchange = async () => {
        const isEnabled = blockAdsToggle.checked;
        await localSet(__DBK_AD_Block_Key, isEnabled);
        await switchAdOn(isEnabled);
        console.log("------>>>Ad blocking is now", isEnabled ? "enabled" : "disabled");
        await sendMessageToX(MsgType.AdsBlockChanged, isEnabled);
    };
}


async function initWalletOrCreate(): Promise<void> {
    const walletCreateBtn = document.getElementById("btn-create-wallet") as HTMLButtonElement;
    const walletInfoDiv = document.getElementById("wallet-info-area") as HTMLDivElement;
    const walletStatus = document.getElementById("wallet-status-message") as HTMLDivElement | null;

    currentWallet = await loadWallet();
    currentSettings = await loadWalletSettings();

    if (!currentWallet) {
        walletCreateBtn.style.display = "block";
        walletInfoDiv.style.display = "none";
        walletCreateBtn.onclick = async () => {
            await browser.tabs.create({
                url: browser.runtime.getURL("html/wallet_new.html"),
            });
        };
    } else {
        walletCreateBtn.style.display = "none";
        walletInfoDiv.style.display = "block";
        await populateWalletInfo(walletInfoDiv, currentWallet);
    }

    if (!walletControlsInitialized) {
        setupWalletActionButtons();
        walletControlsInitialized = true;
    }

    updateSettingsUI(currentSettings);
    updateWalletStatus(walletStatus, currentWallet ? "钱包已准备就绪" : "请先创建或导入钱包");
}

async function populateWalletInfo(container: HTMLDivElement, wallet: TCWallet): Promise<void> {
    const addressSpan = container.querySelector(".wallet-address-value") as HTMLSpanElement;
    const ethSpan = container.querySelector(".wallet-eth-value") as HTMLSpanElement;
    const usdtSpan = container.querySelector(".wallet-usdt-value") as HTMLSpanElement;

    if (addressSpan) {
        addressSpan.textContent = wallet.address;
    }
    if (ethSpan) {
        ethSpan.textContent = "--";
    }
    if (usdtSpan) {
        usdtSpan.textContent = "--";
    }

    await refreshBalances(false);
}

function setupWalletActionButtons(): void {
    const refreshBtn = document.getElementById("btn-refresh-balance") as HTMLButtonElement | null;
    const exportBtn = document.getElementById("btn-export-private-key") as HTMLButtonElement | null;
    const transferEthBtn = document.getElementById("btn-transfer-eth") as HTMLButtonElement | null;
    const transferTokenBtn = document.getElementById("btn-transfer-token") as HTMLButtonElement | null;
    const signMessageBtn = document.getElementById("btn-sign-message") as HTMLButtonElement | null;
    const signTypedBtn = document.getElementById("btn-sign-typed-data") as HTMLButtonElement | null;
    const verifyBtn = document.getElementById("btn-verify-signature") as HTMLButtonElement | null;
    const openSettingsBtn = document.getElementById("btn-open-settings") as HTMLButtonElement | null;
    const saveSettingsBtn = document.getElementById("btn-save-settings") as HTMLButtonElement | null;
    const resetSettingsBtn = document.getElementById("btn-reset-settings") as HTMLButtonElement | null;

    refreshBtn?.addEventListener("click", () => {
        refreshBalances().then();
    });
    exportBtn?.addEventListener("click", () => {
        handleExportPrivateKey().then();
    });
    transferEthBtn?.addEventListener("click", () => {
        handleTransferEth().then();
    });
    transferTokenBtn?.addEventListener("click", () => {
        handleTransferToken().then();
    });
    signMessageBtn?.addEventListener("click", () => {
        handleSignMessage().then();
    });
    signTypedBtn?.addEventListener("click", () => {
        handleSignTypedData().then();
    });
    verifyBtn?.addEventListener("click", () => {
        handleVerifySignature().then();
    });
    openSettingsBtn?.addEventListener("click", () => toggleSettingsPanel());
    saveSettingsBtn?.addEventListener("click", () => {
        handleSaveSettings().then();
    });
    resetSettingsBtn?.addEventListener("click", () => {
        handleResetSettings().then();
    });
}

function updateSettingsUI(settings: WalletSettings): void {
    const infuraInput = document.getElementById("infura-project-id") as HTMLInputElement | null;
    const customInput = document.getElementById("custom-rpc-url") as HTMLInputElement | null;
    const defaultRadio = document.querySelector('input[name="rpc-mode"][value="default"]') as HTMLInputElement | null;
    const customRadio = document.querySelector('input[name="rpc-mode"][value="custom"]') as HTMLInputElement | null;

    if (infuraInput) {
        infuraInput.value = settings.infuraProjectId ?? "";
    }
    if (customInput) {
        customInput.value = settings.customRpcUrl ?? "";
    }
    if (defaultRadio) {
        defaultRadio.checked = settings.useDefaultRpc;
    }
    if (customRadio) {
        customRadio.checked = !settings.useDefaultRpc;
    }
}

function toggleSettingsPanel(): void {
    const panel = document.getElementById("settings-panel") as HTMLDivElement | null;
    if (!panel) return;
    const willOpen = !panel.classList.contains("open");
    panel.classList.toggle("open", willOpen);
    panel.classList.toggle("hidden", !willOpen);
}

async function handleSaveSettings(): Promise<void> {
    const infuraInput = document.getElementById("infura-project-id") as HTMLInputElement | null;
    const customInput = document.getElementById("custom-rpc-url") as HTMLInputElement | null;
    const customRadio = document.querySelector('input[name="rpc-mode"][value="custom"]') as HTMLInputElement | null;
    const walletStatus = document.getElementById("wallet-status-message") as HTMLDivElement | null;

    const newSettings: WalletSettings = {
        infuraProjectId: infuraInput?.value.trim() ?? "",
        customRpcUrl: customInput?.value.trim() ?? "",
        useDefaultRpc: !(customRadio?.checked ?? false),
    };

    await saveWalletSettings(newSettings);
    currentSettings = newSettings;
    updateWalletStatus(walletStatus, "节点配置已保存");
    notifySettingsChanged();
    await refreshBalances();
}

async function handleResetSettings(): Promise<void> {
    const walletStatus = document.getElementById("wallet-status-message") as HTMLDivElement | null;
    currentSettings = {...defaultWalletSettings};
    updateSettingsUI(currentSettings);
    await saveWalletSettings(currentSettings);
    updateWalletStatus(walletStatus, "已恢复默认节点配置");
    notifySettingsChanged();
    await refreshBalances();
}

function notifySettingsChanged(): void {
    if (typeof chrome !== "undefined" && chrome?.runtime?.sendMessage) {
        chrome.runtime.sendMessage({type: "settings:changed"});
    } else if (browser?.runtime?.sendMessage) {
        browser.runtime.sendMessage({type: "settings:changed"});
    }
}

async function refreshBalances(showStatus = true): Promise<void> {
    const walletStatus = document.getElementById("wallet-status-message") as HTMLDivElement | null;
    const ethSpan = document.querySelector(".wallet-eth-value") as HTMLSpanElement | null;
    const usdtSpan = document.querySelector(".wallet-usdt-value") as HTMLSpanElement | null;

    if (!currentWallet) {
        if (ethSpan) ethSpan.textContent = "--";
        if (usdtSpan) usdtSpan.textContent = "--";
        if (showStatus) updateWalletStatus(walletStatus, "请先创建或导入钱包", true);
        return;
    }

    try {
        if (showStatus) updateWalletStatus(walletStatus, "正在刷新余额...");
        const provider = createProvider(currentSettings);
        const usdtContract = new ethers.Contract(USDT_CONTRACT_ADDRESS, ERC20_ABI, provider);

        const [ethBalance, usdtBalance] = await Promise.all([
            provider.getBalance(currentWallet.address),
            usdtContract.balanceOf(currentWallet.address)
        ]);

        if (ethSpan) {
            ethSpan.textContent = formatTokenAmount(ethBalance, 18);
        }
        if (usdtSpan) {
            usdtSpan.textContent = formatTokenAmount(usdtBalance, 6);
        }

        if (showStatus) updateWalletStatus(walletStatus, "余额已刷新");
    } catch (error) {
        if (showStatus) {
            updateWalletStatus(walletStatus, (error as Error).message ?? "刷新余额失败", true);
        }
    }
}

function updateWalletStatus(element: HTMLDivElement | null, message: string, isError = false): void {
    if (!element) return;
    element.textContent = message;
    element.classList.toggle("error", isError);
}

function getRpcEndpoint(settings: WalletSettings): string {
    const infuraId = settings.infuraProjectId?.trim();
    if (infuraId) {
        return `https://arbitrum-mainnet.infura.io/v3/${infuraId}`;
    }
    const custom = settings.customRpcUrl?.trim();
    if (!settings.useDefaultRpc && custom) {
        return custom;
    }
    return DEFAULT_RPC_URL;
}

function createProvider(settings: WalletSettings): ethers.providers.JsonRpcProvider {
    const rpcUrl = getRpcEndpoint(settings);
    return new ethers.providers.JsonRpcProvider(rpcUrl, ARBITRUM_CHAIN_ID);
}

function formatTokenAmount(value: ethers.BigNumber, decimals: number): string {
    const formatted = ethers.utils.formatUnits(value, decimals);
    const numeric = Number(formatted);
    if (!Number.isFinite(numeric)) {
        return formatted;
    }
    return numeric.toLocaleString(undefined, {maximumFractionDigits: Math.min(decimals, 6)});
}

async function handleExportPrivateKey(): Promise<void> {
    const walletStatus = document.getElementById("wallet-status-message") as HTMLDivElement | null;
    if (!currentWallet) {
        updateWalletStatus(walletStatus, "请先创建或导入钱包", true);
        return;
    }

    let privateKey = "";
    try {
        privateKey = await withDecryptedWallet(
            () => requestPassword("请输入钱包口令以导出私钥"),
            async wallet => wallet.privateKey
        );
        updateWalletStatus(walletStatus, "私钥仅一次性展示，请妥善保管");
        window.alert(`私钥：${privateKey}`);
    } catch (error) {
        updateWalletStatus(walletStatus, (error as Error).message ?? "导出私钥失败", true);
    } finally {
        privateKey = "";
    }
}

async function handleTransferEth(): Promise<void> {
    const walletStatus = document.getElementById("wallet-status-message") as HTMLDivElement | null;
    if (!currentWallet) {
        updateWalletStatus(walletStatus, "请先创建或导入钱包", true);
        return;
    }

    const to = window.prompt("请输入接收地址", "");
    if (!to) return;
    const amount = window.prompt("请输入转账 ETH 数量", "");
    if (!amount) return;
    const gasInput = window.prompt("可选：Gas Limit", "");

    try {
        const txHash = await transferEth({
            to: to.trim(),
            amountEther: amount.trim(),
            gas: gasInput?.trim() ? gasInput.trim() : undefined,
            passwordPrompt: () => requestPassword("请输入钱包口令以发送 ETH")
        });
        updateWalletStatus(walletStatus, `交易已发送：${txHash}`);
        await refreshBalances();
    } catch (error) {
        updateWalletStatus(walletStatus, (error as Error).message ?? "转账失败", true);
    }
}

async function handleTransferToken(): Promise<void> {
    const walletStatus = document.getElementById("wallet-status-message") as HTMLDivElement | null;
    if (!currentWallet) {
        updateWalletStatus(walletStatus, "请先创建或导入钱包", true);
        return;
    }

    const tokenAddress = window.prompt("请输入代币合约地址", USDT_CONTRACT_ADDRESS) ?? "";
    if (!tokenAddress.trim()) return;
    const to = window.prompt("请输入接收地址", "");
    if (!to) return;
    const amount = window.prompt("请输入转账数量", "");
    if (!amount) return;
    const decimalsInput = window.prompt("请输入代币精度", "6");
    const gasInput = window.prompt("可选：Gas Limit", "");

    const decimals = decimalsInput ? Number(decimalsInput) : 18;

    try {
        const txHash = await transferErc20({
            tokenAddress: tokenAddress.trim(),
            to: to.trim(),
            amount: amount.trim(),
            decimals: Number.isFinite(decimals) ? decimals : 18,
            gas: gasInput?.trim() ? gasInput.trim() : undefined,
            passwordPrompt: () => requestPassword("请输入钱包口令以发送代币")
        });
        updateWalletStatus(walletStatus, `代币转账已发送：${txHash}`);
        await refreshBalances();
    } catch (error) {
        updateWalletStatus(walletStatus, (error as Error).message ?? "代币转账失败", true);
    }
}

async function handleSignMessage(): Promise<void> {
    const walletStatus = document.getElementById("wallet-status-message") as HTMLDivElement | null;
    if (!currentWallet) {
        updateWalletStatus(walletStatus, "请先创建或导入钱包", true);
        return;
    }

    const message = window.prompt("请输入要签名的消息", "");
    if (message === null) return;

    try {
        const signature = await signMessage({
            message,
            passwordPrompt: () => requestPassword("请输入钱包口令以签名消息")
        });
        updateWalletStatus(walletStatus, "消息签名已生成");
        window.alert(`签名：${signature}`);
    } catch (error) {
        updateWalletStatus(walletStatus, (error as Error).message ?? "签名失败", true);
    }
}

async function handleSignTypedData(): Promise<void> {
    const walletStatus = document.getElementById("wallet-status-message") as HTMLDivElement | null;
    if (!currentWallet) {
        updateWalletStatus(walletStatus, "请先创建或导入钱包", true);
        return;
    }

    const typedInput = window.prompt("请输入包含 domain/types/value 的 JSON", "");
    if (!typedInput) return;

    try {
        const parsed = JSON.parse(typedInput);
        if (!parsed.domain || !parsed.types || !parsed.value) {
            throw new Error("JSON 缺少必要字段");
        }
        const signature = await signTypedData({
            domain: parsed.domain,
            types: parsed.types,
            value: parsed.value,
            passwordPrompt: () => requestPassword("请输入钱包口令以签名数据")
        });
        updateWalletStatus(walletStatus, "TypedData 签名已生成");
        window.alert(`签名：${signature}`);
    } catch (error) {
        const message = error instanceof SyntaxError ? "JSON 解析失败" : (error as Error).message;
        updateWalletStatus(walletStatus, message ?? "签名失败", true);
    }
}

async function handleVerifySignature(): Promise<void> {
    const walletStatus = document.getElementById("wallet-status-message") as HTMLDivElement | null;
    const signature = window.prompt("请输入签名字符串", "");
    if (!signature) return;

    const typedInput = window.prompt("如需验证 TypedData，请输入 JSON，留空则按普通消息", "");
    const expected = window.prompt("可选：期望签名者地址", currentWallet?.address ?? "") ?? "";

    try {
        let result: boolean | string;
        if (typedInput && typedInput.trim()) {
            const parsed = JSON.parse(typedInput);
            result = await verifySignature({
                typed: parsed,
                signature,
                expectedAddress: expected.trim() || undefined,
            });
        } else {
            const message = window.prompt("请输入原始消息", "");
            if (message === null) return;
            result = await verifySignature({
                message,
                signature,
                expectedAddress: expected.trim() || undefined,
            });
        }

        if (typeof result === "boolean") {
            updateWalletStatus(walletStatus, result ? "签名验证通过" : "签名验证失败", !result);
        } else {
            updateWalletStatus(walletStatus, "签名者地址已解析");
            window.alert(`签名者：${result}`);
        }
    } catch (error) {
        const message = error instanceof SyntaxError ? "JSON 解析失败" : (error as Error).message;
        updateWalletStatus(walletStatus, message ?? "验签失败", true);
    }
}

async function requestPassword(promptMessage: string): Promise<string> {
    const input = window.prompt(promptMessage, "");
    if (!input) {
        throw new Error("操作已取消");
    }
    return input;
}

async function withDecryptedWallet<T>(passwordPrompt: PasswordPrompt, action: (wallet: ethers.Wallet) => Promise<T>): Promise<T> {
    if (!currentWallet) {
        throw new Error("请先创建或导入钱包");
    }

    let password = "";
    let wallet: ethers.Wallet | null = null;
    try {
        password = await passwordPrompt();
        if (!password) {
            throw new Error("口令不能为空");
        }
        wallet = await ethers.Wallet.fromEncryptedJson(currentWallet.keystoreJson, password);
        return await action(wallet);
    } finally {
        password = "";
        if (wallet) {
            secureDisposeWallet(wallet);
        }
    }
}

function secureDisposeWallet(wallet: ethers.Wallet): void {
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

interface TransferEthParams {
    to: string;
    amountEther: string;
    gas?: string;
    passwordPrompt: PasswordPrompt;
}

interface TransferErc20Params {
    tokenAddress: string;
    to: string;
    amount: string;
    decimals: number;
    gas?: string;
    passwordPrompt: PasswordPrompt;
}

interface SignMessageParams {
    message: string;
    passwordPrompt: PasswordPrompt;
}

interface TypedDataPayload {
    domain: ethers.utils.TypedDataDomain;
    types: Record<string, ethers.utils.TypedDataField[]>;
    value: Record<string, any>;
}

interface SignTypedDataParams extends TypedDataPayload {
    passwordPrompt: PasswordPrompt;
}

interface VerifySignatureParams {
    message?: string;
    typed?: TypedDataPayload;
    signature: string;
    expectedAddress?: string;
}

export async function transferEth({to, amountEther, gas, passwordPrompt}: TransferEthParams): Promise<string> {
    if (!ethers.utils.isAddress(to)) {
        throw new Error("接收地址无效");
    }
    if (!amountEther) {
        throw new Error("请输入转账金额");
    }

    return withDecryptedWallet(passwordPrompt, async wallet => {
        const provider = createProvider(currentSettings);
        const connected = wallet.connect(provider);
        const txRequest: ethers.providers.TransactionRequest = {
            to,
            value: ethers.utils.parseEther(amountEther),
        };
        if (gas) {
            txRequest.gasLimit = ethers.BigNumber.from(gas);
        }
        const tx = await connected.sendTransaction(txRequest);
        return tx.hash;
    });
}

export async function transferErc20({tokenAddress, to, amount, decimals, gas, passwordPrompt}: TransferErc20Params): Promise<string> {
    if (!ethers.utils.isAddress(tokenAddress)) {
        throw new Error("代币合约地址无效");
    }
    if (!ethers.utils.isAddress(to)) {
        throw new Error("接收地址无效");
    }
    if (!amount) {
        throw new Error("请输入转账数量");
    }

    return withDecryptedWallet(passwordPrompt, async wallet => {
        const provider = createProvider(currentSettings);
        const connected = wallet.connect(provider);
        const contract = new ethers.Contract(tokenAddress, ERC20_ABI, connected);
        const value = ethers.utils.parseUnits(amount, decimals);
        const overrides = gas ? {gasLimit: ethers.BigNumber.from(gas)} : {};
        const tx = await contract.transfer(to, value, overrides);
        return tx.hash;
    });
}

export async function signMessage({message, passwordPrompt}: SignMessageParams): Promise<string> {
    if (!message) {
        throw new Error("消息内容不能为空");
    }
    return withDecryptedWallet(passwordPrompt, wallet => wallet.signMessage(message));
}

export async function signTypedData({domain, types, value, passwordPrompt}: SignTypedDataParams): Promise<string> {
    if (!domain || !types || !value) {
        throw new Error("TypedData 参数不完整");
    }
    return withDecryptedWallet(passwordPrompt, wallet => wallet._signTypedData(domain, types, value));
}

export async function verifySignature({message, typed, signature, expectedAddress}: VerifySignatureParams): Promise<boolean | string> {
    if (!signature) {
        throw new Error("缺少签名");
    }

    let recovered: string;
    if (message !== undefined) {
        recovered = ethers.utils.verifyMessage(message, signature);
    } else if (typed) {
        recovered = ethers.utils.verifyTypedData(typed.domain, typed.types, typed.value, signature);
    } else {
        throw new Error("请提供消息或 TypedData");
    }

    if (expectedAddress) {
        return recovered.toLowerCase() === expectedAddress.toLowerCase();
    }
    return recovered;
}
