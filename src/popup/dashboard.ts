import browser from "webextension-polyfill";
import {ethers} from "ethers";
import {__DBK_AD_Block_Key, MsgType} from "../common/consts";
import {__tableCategory, checkAndInitDatabase, databaseAddItem} from "../common/database";
import {showView} from "../common/utils";
import {Category, loadCategories} from "../object/category";
import {sendMessageToX} from "../service_work/bg_msg";
import {localGet, localSet} from "../common/local_storage";
import {getSystemSetting, switchAdOn} from "../object/system_setting";
import {initI18n, t} from "../common/i18n";
import {
    defaultWalletSettings,
    loadWallet,
    loadWalletSettings,
    saveWallet,
    saveWalletSettings,
    TCWallet,
    WalletSettings
} from "../wallet/wallet_api";
import {hideLoading, showLoading, showNotification} from "./common";
import {
    encryptString,
    IpfsProvider,
    IpfsSettings,
    loadIpfsSettings,
    saveIpfsSettings,
    deleteIpfsSettings,
    EncryptedBlock, hasEncryptedSecrets, decryptSettingsForUI
} from "../wallet/ipfs_settings";
import {resetIpfsClient} from "../wallet/ipfs_api";

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
    initIpfsSettingsView();
}

function dashRouter(path: string): void {
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
    const walletCreateDiv = document.getElementById("wallet-create-div") as HTMLButtonElement;//btn-create-wallet
    const walletInfoDiv = document.getElementById("wallet-info-area") as HTMLDivElement;
    const walletSettingBtn = document.getElementById("wallet-settings-btn") as HTMLButtonElement;

    currentWallet = await loadWallet();
    currentSettings = await loadWalletSettings();

    const walletNewBtn = (walletCreateDiv.querySelector(".btn-create-wallet") as HTMLButtonElement);
    walletNewBtn.textContent = t('new_web3_id');
    if (!currentWallet) {
        walletCreateDiv.style.display = "block";
        walletInfoDiv.style.display = "none";
        walletNewBtn.onclick = async () => {
            await browser.tabs.create({
                url: browser.runtime.getURL("html/wallet_new.html"),
            });
        };
        return;
    }

    walletCreateDiv.style.display = "none";
    walletInfoDiv.style.display = "block";

    await populateWalletInfo(walletInfoDiv, currentWallet);
    walletSettingBtn.onclick = () => {
        showView('#onboarding/wallet-setting', dashRouter);
    }

    setupWalletActionButtons();
    updateSettingsUI(currentSettings);
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
    const backBtn = document.getElementById("wallet-back-btn") as HTMLButtonElement | null;


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
    backBtn?.addEventListener("click", () => {
        // 返回主面板
        showView('#onboarding/main-home', dashRouter);
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

    const newSettings: WalletSettings = {
        infuraProjectId: infuraInput?.value.trim() ?? "",
        customRpcUrl: customInput?.value.trim() ?? "",
        useDefaultRpc: !(customRadio?.checked ?? false),
    };

    await saveWalletSettings(newSettings);
    currentSettings = newSettings;
    showNotification("节点配置已保存");
    notifySettingsChanged();
    await refreshBalances();
}

async function handleResetSettings(): Promise<void> {
    currentSettings = {...defaultWalletSettings};
    updateSettingsUI(currentSettings);
    await saveWalletSettings(currentSettings);
    showNotification("已恢复默认节点配置");
    notifySettingsChanged();
    await refreshBalances();
}

function notifySettingsChanged(): void {
    console.log("------>>> infura setting changed.....")
}

async function refreshBalances(showStatus = true): Promise<void> {
    const ethSpan = document.querySelector(".wallet-eth-value") as HTMLSpanElement | null;
    const usdtSpan = document.querySelector(".wallet-usdt-value") as HTMLSpanElement | null;

    if (!currentWallet) {
        if (ethSpan) ethSpan.textContent = "--";
        if (usdtSpan) usdtSpan.textContent = "--";
        if (showStatus) showNotification("请先创建或导入钱包", "error");
        return;
    }

    try {
        if (showStatus) showNotification("正在刷新余额...");
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

        if (showStatus) showNotification("余额已刷新");
    } catch (error) {
        if (showStatus) {
            showNotification((error as Error).message ?? "刷新余额失败", "error");
        }
    }
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
    if (!currentWallet) {
        showNotification("请先创建或导入钱包", "info");
        return;
    }

    let privateKey = "";
    try {
        privateKey = await withDecryptedWallet(
            () => requestPassword("请输入钱包口令以导出私钥"),
            async wallet => wallet.privateKey
        );
        showNotification("私钥仅一次性展示，请妥善保管");
        window.alert(`私钥：${privateKey}`);
    } catch (error) {
        showNotification((error as Error).message ?? "导出私钥失败", "error");
    } finally {
        privateKey = "";
    }
}

async function handleTransferEth(): Promise<void> {
    if (!currentWallet) {
        showNotification("请先创建或导入钱包", "info");
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
        showNotification(`交易已发送：${txHash}`);
        await refreshBalances();
    } catch (error) {
        showNotification((error as Error).message ?? "转账失败", "error");
    }
}

async function handleTransferToken(): Promise<void> {
    if (!currentWallet) {
        showNotification("请先创建或导入钱包", "info");
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
        showNotification(`代币转账已发送：${txHash}`);
        await refreshBalances();
    } catch (error) {
        showNotification((error as Error).message ?? "代币转账失败", "error");
    }
}

async function handleSignMessage(): Promise<void> {
    if (!currentWallet) {
        showNotification("请先创建或导入钱包", "info");
        return;
    }

    const message = window.prompt("请输入要签名的消息", "");
    if (message === null) return;

    try {
        const signature = await signMessage({
            message,
            passwordPrompt: () => requestPassword("请输入钱包口令以签名消息")
        });
        showNotification("消息签名已生成");
        window.alert(`签名：${signature}`);
    } catch (error) {
        showNotification((error as Error).message ?? "签名失败", "error");
    }
}

async function handleSignTypedData(): Promise<void> {
    if (!currentWallet) {
        showNotification("请先创建或导入钱包", "info");
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
        showNotification("TypedData 签名已生成");
        window.alert(`签名：${signature}`);
    } catch (error) {
        const message = error instanceof SyntaxError ? "JSON 解析失败" : (error as Error).message;
        showNotification(message ?? "签名失败", "error");
    }
}

async function handleVerifySignature(): Promise<void> {
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
            showNotification(result ? "签名验证通过" : "签名验证失败", "error");
        } else {
            showNotification("签名者地址已解析");
            window.alert(`签名者：${result}`);
        }
    } catch (error) {
        const message = error instanceof SyntaxError ? "JSON 解析失败" : (error as Error).message;
        showNotification(message ?? "验签失败", "error");
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
    domain: ethers.TypedDataDomain;
    types: Record<string, Array<ethers.TypedDataField>>;
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

export async function transferErc20({
                                        tokenAddress,
                                        to,
                                        amount,
                                        decimals,
                                        gas,
                                        passwordPrompt
                                    }: TransferErc20Params): Promise<string> {
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

export async function verifySignature({
                                          message,
                                          typed,
                                          signature,
                                          expectedAddress
                                      }: VerifySignatureParams): Promise<boolean | string> {
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

function showAlert(title: string, message: string) {
    const alertBox = document.getElementById('custom-alert');
    const alertTitle = document.getElementById('alert-title');
    const alertMessage = document.getElementById('alert-message');
    const alertOk = document.getElementById('alert-ok');

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

function $(sel: string) {
    return document.querySelector(sel) as HTMLElement | null;
}

function $input(sel: string) {
    return document.querySelector(sel) as HTMLInputElement | null;
}

type PendingField = { label: string; value: string; apply: (block: EncryptedBlock) => void; };

let currentIpfsSettings: IpfsSettings | null = null;

function providerRadios(): HTMLInputElement[] {
    return Array.from(document.querySelectorAll<HTMLInputElement>('input[name="ipfs-provider"]'));
}

function getSelectedProvider(): IpfsProvider {
    const checked = providerRadios().find(r => r.checked);
    return (checked?.value as IpfsProvider) || 'tweetcat';
}

function setSelectedProvider(provider: IpfsProvider): void {
    providerRadios().forEach(radio => {
        radio.checked = radio.value === provider;
    });
}

function updateProviderVisibility(): void {
    const provider = getSelectedProvider();
    document.querySelectorAll<HTMLElement>('.ipfs-provider-section').forEach(section => {
        const sectionProvider = section.dataset.provider as IpfsProvider | undefined;
        section.hidden = !!sectionProvider && sectionProvider !== provider;
    });
    toggleRevealButton(provider);
}

function toggleRevealButton(provider: IpfsProvider): void {
    const btn = document.getElementById('btn-ipfs-reveal') as HTMLButtonElement | null;
    if (!btn) return;
    // 仅在 pinata / lighthouse / custom 显示；tweetcat 为只读说明，不展示
    btn.hidden = !(provider === 'pinata' || provider === 'lighthouse' || provider === 'custom');
}

async function handleIpfsReveal(): Promise<void> {
    try {
        // 优先用内存里的 currentIpfsSettings；若为空再读一次
        const saved = currentIpfsSettings ?? await loadIpfsSettings();
        if (!saved) {
            showNotification('尚无已保存的 IPFS 设置', 'info');
            return;
        }

        const provider = saved.provider;
        if (provider === 'tweetcat') {
            showNotification('TweetCat 官方节点无敏感配置可解密', 'info');
            return;
        }

        if (!hasEncryptedSecrets(saved)) {
            showNotification('当前没有可解密的敏感字段', 'info');
            return;
        }

        const password = await requestPassword('请输入用于解密查看的口令（仅用于临时查看，不会保存明文）');
        const dec = await decryptSettingsForUI(saved, password);

        // 仅展示弹窗，不写回输入框，避免 scheduleSensitive 把“查看”当作“修改”
        let lines: string[] = [];
        if (dec.provider === 'pinata' && dec.pinata) {
            if (dec.pinata.jwt)    lines.push(`Pinata JWT:\n${dec.pinata.jwt}`);
            if (dec.pinata.apiKey) lines.push(`Pinata API Key:\n${dec.pinata.apiKey}`);
            if (dec.pinata.secret) lines.push(`Pinata API Secret:\n${dec.pinata.secret}`);
        } else if (dec.provider === 'lighthouse' && dec.lighthouse) {
            if (dec.lighthouse.jwt)    lines.push(`Lighthouse JWT:\n${dec.lighthouse.jwt}`);
            if (dec.lighthouse.apiKey) lines.push(`Lighthouse API Key:\n${dec.lighthouse.apiKey}`);
        } else if (dec.provider === 'custom' && dec.custom) {
            // apiUrl / gatewayUrl 本就明文；这里仅在存在 auth 时展示
            if (dec.custom.auth) lines.push(`自建节点 Authorization:\n${dec.custom.auth}`);
        }

        if (lines.length === 0) {
            showNotification('已解密，但没有可展示的敏感字段', 'info');
            return;
        }

        showAlert('当前已保存的配置（请妥善保密）', lines.join('\n\n'));
    } catch (e) {
        showNotification((e as Error).message ?? '解密失败', 'error');
    }
}


function setSensitiveState(input: HTMLInputElement | null, hasValue: boolean): void {
    if (!input) return;
    if (!input.dataset.defaultPlaceholder) {
        input.dataset.defaultPlaceholder = input.placeholder ?? '';
    }
    input.value = '';
    input.dataset.hasValue = hasValue ? '1' : '0';
    input.placeholder = hasValue ? '已设置' : (input.dataset.defaultPlaceholder ?? '');
    input.classList.toggle('has-secret', hasValue);
}

function scheduleSensitive(
    input: HTMLInputElement | null,
    existing: EncryptedBlock | undefined,
    label: string,
    assign: (block: EncryptedBlock | undefined) => void,
    pending: PendingField[],
): void {
    if (!input) {
        assign(existing);
        return;
    }
    const value = input.value.trim();
    const hasExisting = input.dataset.hasValue === '1' && !!existing;
    if (value) {
        pending.push({
            label,
            value,
            apply: (block) => assign(block),
        });
    } else if (hasExisting) {
        assign(existing);
    } else {
        assign(undefined);
    }
}

async function fillIpfsForm(): Promise<void> {
    currentIpfsSettings = await loadIpfsSettings();
    const provider = currentIpfsSettings?.provider ?? 'tweetcat';
    setSelectedProvider(provider);
    updateProviderVisibility();
    toggleRevealButton(provider);

    const pinata = currentIpfsSettings?.pinata;
    setSensitiveState($input('#pinata-api-key'), !!pinata?.apiKeyEnc);
    setSensitiveState($input('#pinata-api-secret'), !!pinata?.secretEnc);
    setSensitiveState($input('#pinata-jwt'), !!pinata?.jwtEnc);

    const lighthouse = currentIpfsSettings?.lighthouse;
    setSensitiveState($input('#lighthouse-api-key'), !!lighthouse?.apiKeyEnc);
    setSensitiveState($input('#lighthouse-jwt'), !!lighthouse?.jwtEnc);

    const custom = currentIpfsSettings?.custom;
    const apiUrlInput = $input('#custom-api-url');
    if (apiUrlInput) apiUrlInput.value = custom?.apiUrl ?? '';
    const gatewayInput = $input('#custom-gateway-url');
    if (gatewayInput) gatewayInput.value = custom?.gatewayUrl ?? '';
    setSensitiveState($input('#custom-auth'), !!custom?.authEnc);

    const clearBtn = document.getElementById('ipfs-settings-clear') as HTMLButtonElement | null;
    if (clearBtn) clearBtn.disabled = !currentIpfsSettings;
}

async function handleIpfsSave(): Promise<void> {
    try {
        const provider = getSelectedProvider();
        const pending: PendingField[] = [];
        const next: IpfsSettings = {
            id: 'ipfs',
            provider,
            pinata: currentIpfsSettings?.pinata ? {...currentIpfsSettings.pinata} : undefined,
            lighthouse: currentIpfsSettings?.lighthouse ? {...currentIpfsSettings.lighthouse} : undefined,
            custom: currentIpfsSettings?.custom ? {...currentIpfsSettings.custom} : undefined,
        };

        if (provider === 'pinata') {
            const pinata: NonNullable<IpfsSettings['pinata']> = {};
            scheduleSensitive($input('#pinata-jwt'), currentIpfsSettings?.pinata?.jwtEnc, 'Pinata JWT', block => {
                if (block) {
                    pinata.jwtEnc = block;
                } else {
                    delete pinata.jwtEnc;
                }
            }, pending);
            scheduleSensitive($input('#pinata-api-key'), currentIpfsSettings?.pinata?.apiKeyEnc, 'Pinata API Key', block => {
                if (block) {
                    pinata.apiKeyEnc = block;
                } else {
                    delete pinata.apiKeyEnc;
                }
            }, pending);
            scheduleSensitive($input('#pinata-api-secret'), currentIpfsSettings?.pinata?.secretEnc, 'Pinata API Secret', block => {
                if (block) {
                    pinata.secretEnc = block;
                } else {
                    delete pinata.secretEnc;
                }
            }, pending);
            next.pinata = pinata;
        } else if (provider === 'lighthouse') {
            const lighthouse: NonNullable<IpfsSettings['lighthouse']> = {};
            scheduleSensitive($input('#lighthouse-jwt'), currentIpfsSettings?.lighthouse?.jwtEnc, 'Lighthouse JWT', block => {
                if (block) {
                    lighthouse.jwtEnc = block;
                } else {
                    delete lighthouse.jwtEnc;
                }
            }, pending);
            scheduleSensitive($input('#lighthouse-api-key'), currentIpfsSettings?.lighthouse?.apiKeyEnc, 'Lighthouse API Key', block => {
                if (block) {
                    lighthouse.apiKeyEnc = block;
                } else {
                    delete lighthouse.apiKeyEnc;
                }
            }, pending);
            next.lighthouse = lighthouse;
        } else if (provider === 'custom') {
            const apiUrl = $input('#custom-api-url')?.value.trim() ?? '';
            if (!apiUrl) {
                throw new Error('请填写自建节点 API URL');
            }
            const gatewayUrl = $input('#custom-gateway-url')?.value.trim() ?? '';
            const custom: NonNullable<IpfsSettings['custom']> = {
                apiUrl,
                gatewayUrl: gatewayUrl || undefined,
            };
            scheduleSensitive($input('#custom-auth'), currentIpfsSettings?.custom?.authEnc, '自建节点 Authorization', block => {
                if (block) {
                    custom.authEnc = block;
                } else {
                    delete custom.authEnc;
                }
            }, pending);
            next.custom = custom;
        }

        let password = '';
        if (pending.length > 0) {
            password = await requestPassword('请输入用于加密 IPFS 凭据的口令');
        }

        for (const task of pending) {
            const block = await encryptString(task.value, password);
            task.apply(block);
        }

        if (provider === 'pinata') {
            const pinata = next.pinata ?? {};
            const hasJwt = !!pinata.jwtEnc;
            const hasKeyPair = !!pinata.apiKeyEnc && !!pinata.secretEnc;
            if (!hasJwt && !hasKeyPair) {
                throw new Error('请至少填写 Pinata JWT 或 API Key/Secret');
            }
        } else if (provider === 'lighthouse') {
            const lighthouse = next.lighthouse ?? {};
            if (!lighthouse.jwtEnc && !lighthouse.apiKeyEnc) {
                throw new Error('请填写 Lighthouse API Key 或 JWT');
            }
        } else if (provider === 'custom') {
            if (!next.custom?.apiUrl) {
                throw new Error('请填写自建节点 API URL');
            }
        }

        await saveIpfsSettings(next);
        resetIpfsClient();
        currentIpfsSettings = next;
        showNotification('已保存（加密）', 'info');
        showView('#onboarding/main-home', dashRouter);
    } catch (error) {
        const message = (error as Error).message ?? '保存失败';
        showNotification(message, 'error');
    }
}

async function handleClearIpfsSettings(): Promise<void> {
    try {
        await deleteIpfsSettings();
        resetIpfsClient();
        currentIpfsSettings = null;
        showNotification('已清除 IPFS 设置', 'info');
        await fillIpfsForm();
    } catch (error) {
        const message = (error as Error).message ?? '清除失败';
        showNotification(message, 'error');
    }
}

export function initIpfsSettingsView() {
    providerRadios().forEach(radio => {
        radio.addEventListener('change', () => {
            updateProviderVisibility();
            toggleRevealButton(getSelectedProvider());
        });
    });

    $(".ipfs-settings-btn")?.addEventListener("click", async () => {
        await fillIpfsForm();
        showView('#onboarding/ipfs-settings', dashRouter);
    });

    document.getElementById('btn-ipfs-reveal')?.addEventListener('click', () => { handleIpfsReveal().then(); });

    $("#ipfs-back-btn")?.addEventListener("click", () => {
        showView('#onboarding/main-home', dashRouter);
    });

    document.querySelectorAll<HTMLElement>('[data-ipfs-link]').forEach(btn => {
        btn.addEventListener('click', (ev) => {
            const url = (ev.currentTarget as HTMLElement).getAttribute('data-ipfs-link');
            if (url) {
                window.open(url, '_blank');
            }
        });
    });

    $("#ipfs-settings-save")?.addEventListener("click", () => {
        handleIpfsSave().then();
    });

    $("#ipfs-settings-clear")?.addEventListener("click", () => {
        handleClearIpfsSettings().then();
    });

    updateProviderVisibility();
    toggleRevealButton(getSelectedProvider());
}
