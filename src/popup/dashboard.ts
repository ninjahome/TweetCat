import browser from "webextension-polyfill";
import {ethers} from "ethers";
import {__DBK_AD_Block_Key, MsgType} from "../common/consts";
import {checkAndInitDatabase} from "../common/database";
import {showView} from "../common/utils";
import {sendMessageToX} from "../service_work/bg_msg";
import {localGet, localSet} from "../common/local_storage";
import {getSystemSetting, switchAdOn} from "../object/system_setting";
import {initI18n, t} from "../common/i18n";
import {
    defaultWalletSettings,
    loadWallet,
    loadWalletSettings,
    saveWalletSettings,
    TCWallet,
    WalletSettings
} from "../wallet/wallet_api";
import {$, $Id, $input, showNotification} from "./common";
import {
    encryptString,
    IpfsProvider,
    IpfsSettings,
    loadIpfsSettings,
    saveIpfsSettings,
    EncryptedBlock, decryptSettingsForUI, PROVIDER_TYPE_PINATA, PROVIDER_TYPE_LIGHTHOUSE, PROVIDER_TYPE_CUSTOM,
    PROVIDER_TYPE_TWEETCAT
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
    const mgnCategoryBtn = $Id("btn-mgn-category") as HTMLElement;
    mgnCategoryBtn.innerText = t('manage_category');
    mgnCategoryBtn.onclick = async () => {
        await browser.tabs.create({
            url: browser.runtime.getURL("html/following_mgm.html"),
        })
    }
}

async function setHomeStatus() {
    const isEnabled: boolean = await localGet(__DBK_AD_Block_Key) as boolean ?? false//TODO:: refactor __DBK_AD_Block_Key logic
    const blockAdsToggle = $Id('ad-block-toggle') as HTMLInputElement;
    blockAdsToggle.checked = isEnabled;

    const adNumber = document.querySelector(".number-blocked-txt") as HTMLSpanElement;
    (document.querySelector(".ads-blocked-tips") as HTMLSpanElement).innerText = t('block_ads');
    const setting = await getSystemSetting();
    adNumber.innerText = "" + setting.adsBlocked
}

function initSettings() {
    const blockAdsToggle = $Id('ad-block-toggle') as HTMLInputElement;

    blockAdsToggle.onchange = async () => {
        const isEnabled = blockAdsToggle.checked;
        await localSet(__DBK_AD_Block_Key, isEnabled);
        await switchAdOn(isEnabled);
        await sendMessageToX(MsgType.AdsBlockChanged, isEnabled);
    };
}


async function initWalletOrCreate(): Promise<void> {
    const walletCreateDiv = $Id("wallet-create-div") as HTMLButtonElement;//btn-create-wallet
    const walletInfoDiv = $Id("wallet-info-area") as HTMLDivElement;
    const walletSettingBtn = $Id("wallet-settings-btn") as HTMLButtonElement;
    const walletMainBtn = $Id("btn-main-menu") as HTMLButtonElement;
    const walletMainMenu = $Id("wallet-main-menu") as HTMLDivElement;

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
    (document.querySelector(".logo-container") as HTMLDivElement).style.display = 'none';
    populateWalletInfo(walletInfoDiv, currentWallet).then();

    walletSettingBtn.onclick = () => {
        showView('#onboarding/wallet-setting', dashRouter);
    }

    walletMainBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        walletMainMenu.classList.toggle("hidden");
    });

    walletMainMenu.addEventListener("click", (ev) => {
        ev.stopPropagation();
    });

    document.addEventListener("click", (ev) => {
        const target = ev.target as Node | null;
        if (!target) return;

        // 已经是隐藏的，就不用处理了
        if (walletMainMenu.classList.contains("hidden")) {
            return;
        }

        // 点在菜单内部：不关闭
        if (walletMainMenu.contains(target)) {
            return;
        }

        // 点在按钮本身（或按钮里的 svg）：不关闭
        if (walletMainBtn === target || walletMainBtn.contains(target)) {
            return;
        }

        // 其它情况：关闭菜单
        walletMainMenu.classList.add("hidden");
    });

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
    const refreshBtn = $Id("btn-refresh-balance") as HTMLButtonElement | null;
    const exportBtn = $Id("btn-export-private-key") as HTMLButtonElement | null;
    const transferEthBtn = $Id("btn-transfer-eth") as HTMLButtonElement | null;
    const transferTokenBtn = $Id("btn-transfer-token") as HTMLButtonElement | null;
    const signMessageBtn = $Id("btn-sign-message") as HTMLButtonElement | null;
    const signTypedBtn = $Id("btn-sign-typed-data") as HTMLButtonElement | null;
    const verifyBtn = $Id("btn-verify-signature") as HTMLButtonElement | null;
    const openSettingsBtn = $Id("btn-open-settings") as HTMLElement | null;
    const saveSettingsBtn = $Id("btn-save-settings") as HTMLButtonElement | null;
    const resetSettingsBtn = $Id("btn-reset-settings") as HTMLButtonElement | null;
    const backBtn = $Id("wallet-back-btn") as HTMLButtonElement | null;


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
        showView('#onboarding/main-home', dashRouter);
    });
}

function updateSettingsUI(settings: WalletSettings): void {
    const infuraInput = $Id("infura-project-id") as HTMLInputElement | null;
    const customInput = $Id("custom-rpc-url") as HTMLInputElement | null;
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
    const panel = $Id("settings-panel") as HTMLDivElement | null;
    if (!panel) return;
    const willOpen = !panel.classList.contains("open");
    panel.classList.toggle("open", willOpen);
    panel.classList.toggle("hidden", !willOpen);
}

async function handleSaveSettings(): Promise<void> {
    const infuraInput = $Id("infura-project-id") as HTMLInputElement | null;
    const customInput = $Id("custom-rpc-url") as HTMLInputElement | null;
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

    try {
        const privateKey = await withDecryptedWallet(
            () => requestPassword("请输入钱包口令以导出私钥"),
            async wallet => wallet.privateKey
        );
        showNotification("私钥仅一次性展示，请妥善保管");
        window.alert(`私钥：${privateKey}`);//TODO::
    } catch (error) {
        showNotification((error as Error).message ?? "导出私钥失败", "error");
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
            showNotification("JSON 缺少必要字段", "error");
            return;
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
            showNotification(result ? "签名验证通过" : "签名验证失败", result ? undefined : "error");
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

    let wallet: ethers.Wallet | null = null;
    try {
        const password = await passwordPrompt();
        if (!password) {
            throw new Error("口令不能为空");
        }
        wallet = await ethers.Wallet.fromEncryptedJson(currentWallet.keystoreJson, password);
        return await action(wallet);
    } finally {
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


type PendingField = { label: string; value: string; apply: (block: EncryptedBlock) => void; };

let currentIpfsSettings: IpfsSettings | null = null;

function getSelectedProvider(): IpfsProvider {
    const sel = $Id('ipfs-provider-select') as HTMLSelectElement;
    return (sel?.value as IpfsProvider) || PROVIDER_TYPE_TWEETCAT;
}

function setSelectedProvider(provider: IpfsProvider): void {
    const sel = $Id('ipfs-provider-select') as HTMLSelectElement;
    if (sel) {
        sel.value = provider;
    }
}

function updateProviderVisibility(): void {
    const provider = getSelectedProvider();
    document.querySelectorAll<HTMLElement>('.ipfs-provider-section').forEach(section => {
        const sectionProvider = section.dataset.provider as IpfsProvider | undefined;
        section.hidden = !!sectionProvider && sectionProvider !== provider;
    });

    const sel = $Id('ipfs-provider-set-tweetcat');
    if (provider === PROVIDER_TYPE_TWEETCAT) {
        sel.classList.add("is-default")
    } else {
        sel.classList.remove("is-default")
    }
}

function setSensitiveState(input: HTMLInputElement | null, hasValue: boolean): void {
    if (!input) return;

    // 记住初始 placeholder，方便恢复
    if (!input.dataset.defaultPlaceholder) {
        input.dataset.defaultPlaceholder = input.placeholder ?? "";
    }

    input.dataset.hasValue = hasValue ? "1" : "0";

    if (hasValue) {
        input.value = "";
        input.placeholder = "已设置";
        input.readOnly = true;
        input.type = "password";
        input.classList.add("has-secret", "secret-readonly");
    } else {
        // ✅ 没有任何内容：正常可编辑
        input.value = "";
        input.placeholder = input.dataset.defaultPlaceholder ?? "";
        input.readOnly = false;
        input.classList.remove("secret-readonly");
    }
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
    const provider = currentIpfsSettings?.provider ?? PROVIDER_TYPE_TWEETCAT;
    setSelectedProvider(provider);
    updateProviderVisibility();

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
}

async function handleIpfsSave(): Promise<boolean> {
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

        if (provider === PROVIDER_TYPE_PINATA) {
            const pinata: NonNullable<IpfsSettings[typeof PROVIDER_TYPE_PINATA]> = {};
            scheduleSensitive($input('#pinata-jwt'), currentIpfsSettings?.pinata?.jwtEnc, 'Pinata JWT', block => {
                if (block) pinata.jwtEnc = block; else delete pinata.jwtEnc;
            }, pending);
            scheduleSensitive($input('#pinata-api-key'), currentIpfsSettings?.pinata?.apiKeyEnc, 'Pinata API Key', block => {
                if (block) pinata.apiKeyEnc = block; else delete pinata.apiKeyEnc;
            }, pending);
            scheduleSensitive($input('#pinata-api-secret'), currentIpfsSettings?.pinata?.secretEnc, 'Pinata API Secret', block => {
                if (block) pinata.secretEnc = block; else delete pinata.secretEnc;
            }, pending);
            next.pinata = pinata;
        } else if (provider === PROVIDER_TYPE_LIGHTHOUSE) {
            const lighthouse: NonNullable<IpfsSettings[typeof PROVIDER_TYPE_LIGHTHOUSE]> = {};
            scheduleSensitive($input('#lighthouse-jwt'), currentIpfsSettings?.lighthouse?.jwtEnc, 'Lighthouse JWT', block => {
                if (block) lighthouse.jwtEnc = block; else delete lighthouse.jwtEnc;
            }, pending);
            scheduleSensitive($input('#lighthouse-api-key'), currentIpfsSettings?.lighthouse?.apiKeyEnc, 'Lighthouse API Key', block => {
                if (block) lighthouse.apiKeyEnc = block; else delete lighthouse.apiKeyEnc;
            }, pending);
            next.lighthouse = lighthouse;
        } else if (provider === PROVIDER_TYPE_CUSTOM) {
            const apiUrl = $input('#custom-api-url')?.value.trim() ?? '';
            if (!apiUrl) {
                showNotification('请填写自建节点 API URL', 'error');
                return false;
            }
            const gatewayUrl = $input('#custom-gateway-url')?.value.trim() ?? '';
            const custom: NonNullable<IpfsSettings[typeof PROVIDER_TYPE_CUSTOM]> = {
                apiUrl,
                gatewayUrl: gatewayUrl || undefined
            };
            scheduleSensitive($input('#custom-auth'), currentIpfsSettings?.custom?.authEnc, '自建节点 Authorization', block => {
                if (block) custom.authEnc = block; else delete custom.authEnc;
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

        if (provider === PROVIDER_TYPE_PINATA) {
            const p = next.pinata ?? {};
            const hasJwt = !!p.jwtEnc;
            const hasKeyPair = !!p.apiKeyEnc && !!p.secretEnc;
            if (!hasJwt && !hasKeyPair) {
                showNotification('请至少填写 Pinata JWT 或 API Key/Secret', 'error');
                return false;
            }
        } else if (provider === PROVIDER_TYPE_LIGHTHOUSE) {
            const l = next.lighthouse ?? {};
            if (!l.jwtEnc && !l.apiKeyEnc) {
                showNotification('请填写 Lighthouse API Key 或 JWT', 'error');
                return false;
            }
        } else if (provider === PROVIDER_TYPE_CUSTOM) {
            if (!next.custom?.apiUrl) {
                showNotification('请填写自建节点 API URL', 'error');
                return false;
            }
        }

        await saveIpfsSettings(next);
        resetIpfsClient();
        currentIpfsSettings = next;
        showNotification('已保存（加密）', 'info');
        return true;
    } catch (error) {
        const message = (error as Error).message ?? '保存失败';
        showNotification(message, 'error');
        return false;
    }
}

export function initIpfsSettingsView() {
    // 一级：select 改变'
    const sel = $Id('ipfs-provider-select') as HTMLSelectElement;
    sel?.addEventListener('change', () => {
        updateProviderVisibility();
        refreshSensitiveIndicators();
    });

    // 打开视图
    $(".ipfs-settings-btn")?.addEventListener("click", async () => {
        await fillIpfsForm();
        showView('#onboarding/ipfs-settings', dashRouter);
    });


    const set_default_node = $Id('ipfs-provider-set-tweetcat');
    set_default_node.textContent=t("use_office_ipfs_node")
    set_default_node?.addEventListener('click', () => {
        setTweetcatAsDefault().then();
    });
    const default_node_noti=$Id('tweetcat-node-notification')
    default_node_noti.textContent=t('default_node_noti')

    const pinata_decrypt_btn= $Id('pinata-reveal-fill')
    pinata_decrypt_btn.textContent=t("decrypt_config")
    pinata_decrypt_btn?.addEventListener('click', () => {
        revealAndFill(PROVIDER_TYPE_PINATA).then();
    });
    const pinata_save_btn= $Id('pinata-save')
    pinata_save_btn.textContent=t("save_config")
    pinata_save_btn?.addEventListener('click', () => {
        saveProviderSecrets(PROVIDER_TYPE_PINATA).then();
    });
    const pinata_clean_btn= $Id('pinata-clear')
    pinata_clean_btn.textContent=t("clean_config")
    pinata_clean_btn?.addEventListener('click', () => {
        clearProviderSecrets(PROVIDER_TYPE_PINATA).then();
    });

    const lighthouse_decrypt_btn= $Id('lighthouse-reveal-fill')
    lighthouse_decrypt_btn.textContent=t("decrypt_config")
    lighthouse_decrypt_btn?.addEventListener('click', () => {
        revealAndFill(PROVIDER_TYPE_LIGHTHOUSE).then();
    });
    const lighthouse_save_btn= $Id('lighthouse-save')
    lighthouse_save_btn.textContent=t("save_config")
    lighthouse_save_btn?.addEventListener('click', () => {
        saveProviderSecrets(PROVIDER_TYPE_LIGHTHOUSE).then();
    });
    const lighthouse_clean_btn= $Id('lighthouse-clear')
    lighthouse_clean_btn.textContent=t("clean_config")
    lighthouse_clean_btn?.addEventListener('click', () => {
        clearProviderSecrets(PROVIDER_TYPE_LIGHTHOUSE).then();
    });

    const custom_decrypt_btn= $Id('custom-reveal-fill')
    custom_decrypt_btn.textContent=t("decrypt_config")
    custom_decrypt_btn?.addEventListener('click', () => {
        revealAndFill(PROVIDER_TYPE_CUSTOM).then();
    });
    const custom_save_btn= $Id('custom-save')
    custom_save_btn.textContent=t("save_config")
    custom_save_btn?.addEventListener('click', () => {
        saveProviderSecrets(PROVIDER_TYPE_CUSTOM).then();
    });
    const custom_clean_btn= $Id('custom-clear')
    custom_clean_btn.textContent=t("clean_config")
    custom_clean_btn?.addEventListener('click', () => {
        clearProviderSecrets(PROVIDER_TYPE_CUSTOM).then();
    });

    // 返回按钮与外链保留
    $("#ipfs-back-btn")?.addEventListener("click", async () => {
        await saveProviderOnly();
        showView('#onboarding/main-home', dashRouter);
    });
    document.querySelectorAll<HTMLElement>('[data-ipfs-link]').forEach(btn => {
        btn.addEventListener('click', (ev) => {
            const url = (ev.currentTarget as HTMLElement).getAttribute('data-ipfs-link');
            if (url) window.open(url, '_blank');
        });
    });

    updateProviderVisibility();

    initSecretToggleButtons();
}

function refreshSensitiveIndicators(): void {
    const pinata = currentIpfsSettings?.pinata;
    setSensitiveState($input('#pinata-api-key'), !!pinata?.apiKeyEnc);
    setSensitiveState($input('#pinata-api-secret'), !!pinata?.secretEnc);
    setSensitiveState($input('#pinata-jwt'), !!pinata?.jwtEnc);

    const lighthouse = currentIpfsSettings?.lighthouse;
    setSensitiveState($input('#lighthouse-api-key'), !!lighthouse?.apiKeyEnc);
    setSensitiveState($input('#lighthouse-jwt'), !!lighthouse?.jwtEnc);

    const custom = currentIpfsSettings?.custom;
    // 注意：自建节点的 apiUrl / gatewayUrl 是明文，不在这里改，避免覆盖用户未保存的编辑
    setSensitiveState($input('#custom-auth'), !!custom?.authEnc);
}

function hasEncryptedSecretsFor(provider: IpfsProvider, saved: IpfsSettings): boolean {
    if (provider === PROVIDER_TYPE_PINATA) {
        return !!(saved.pinata?.jwtEnc || saved.pinata?.apiKeyEnc || saved.pinata?.secretEnc);
    }
    if (provider === PROVIDER_TYPE_LIGHTHOUSE) {
        return !!(saved.lighthouse?.jwtEnc || saved.lighthouse?.apiKeyEnc);
    }
    if (provider === PROVIDER_TYPE_CUSTOM) {
        return !!saved.custom?.authEnc;
    }
    return false;
}

async function setTweetcatAsDefault(): Promise<void> {
    const saved = currentIpfsSettings ?? await loadIpfsSettings();
    const next: IpfsSettings = {
        id: 'ipfs',
        provider: PROVIDER_TYPE_TWEETCAT,
        pinata: saved?.pinata,
        lighthouse: saved?.lighthouse,
        custom: saved?.custom,
    };
    await saveIpfsSettings(next);
    currentIpfsSettings = next;
    setSelectedProvider(PROVIDER_TYPE_TWEETCAT);
    updateProviderVisibility();
    showNotification('已设为 TweetCat 默认');
}

function fillPlain(selector: string, value: string | undefined) {
    if (!value) return;
    const el = $input(selector);
    if (!el) return;

    el.value = value;          // ★ 直接回填明文
    el.dataset.hasValue = '1'; // 标记“这个字段有内容”
    el.readOnly = false;       // ★ 解密后允许编辑
    el.classList.remove('secret-readonly');
}

async function revealAndFill(provider: IpfsProvider): Promise<void> {
    const saved = currentIpfsSettings ?? await loadIpfsSettings();
    if (!saved) {
        showNotification('尚无已保存的 IPFS 设置', 'info');
        return;
    }
    if (provider === PROVIDER_TYPE_TWEETCAT) {
        showNotification('TweetCat 无敏感配置', 'info');
        return;
    }

    if (!hasEncryptedSecretsFor(provider, saved)) {
        showNotification('当前提供方没有可解密的敏感字段', 'info');
        return;
    }

    const password = await requestPassword('请输入用于解密查看的口令');
    const dec = await decryptSettingsForUI(saved, password);

    if (provider === PROVIDER_TYPE_PINATA && dec.pinata) {
        fillPlain('#pinata-api-key', dec.pinata.apiKey);
        fillPlain('#pinata-api-secret', dec.pinata.secret);
        fillPlain('#pinata-jwt', dec.pinata.jwt);
    } else if (provider === PROVIDER_TYPE_LIGHTHOUSE && dec.lighthouse) {
        fillPlain('#lighthouse-api-key', dec.lighthouse.apiKey);
        fillPlain('#lighthouse-jwt', dec.lighthouse.jwt);
    } else if (provider === PROVIDER_TYPE_CUSTOM && dec.custom) {
        fillPlain('#custom-auth', dec.custom.auth);
    }

    showNotification('已解密并回填至输入框（可直接修改后保存）', 'info');
}

async function saveProviderSecrets(_provider: IpfsProvider): Promise<void> {
    await handleIpfsSave(); // 当前分区就是当前 provider，直接保存分支即可
}

async function clearProviderSecrets(provider: IpfsProvider): Promise<void> {
    if (!window.confirm('确认清空该 Provider 的密文？此操作不可恢复。')) return;

    const saved = currentIpfsSettings ?? await loadIpfsSettings();
    if (!saved) {
        showNotification('尚无已保存的设置', 'info');
        return;
    }

    const next: IpfsSettings = {
        ...saved,
        pinata: saved.pinata ? {...saved.pinata} : undefined,
        lighthouse: saved.lighthouse ? {...saved.lighthouse} : undefined,
        custom: saved.custom ? {...saved.custom} : undefined,
    };

    if (provider === PROVIDER_TYPE_PINATA) {
        if (next.pinata) {
            delete next.pinata.apiKeyEnc;
            delete next.pinata.secretEnc;
            delete next.pinata.jwtEnc;
        }
    } else if (provider === PROVIDER_TYPE_LIGHTHOUSE) {
        if (next.lighthouse) {
            delete next.lighthouse.apiKeyEnc;
            delete next.lighthouse.jwtEnc;
        }
    } else if (provider === PROVIDER_TYPE_CUSTOM) {
        if (next.custom) {
            delete next.custom.authEnc;
        }
    } else {
        showNotification('TweetCat 无需清空', 'info');
        return;
    }

    await saveIpfsSettings(next);
    currentIpfsSettings = next;

    // 清空输入框显示 & 提示
    if (provider === PROVIDER_TYPE_PINATA) {
        ['#pinata-api-key', '#pinata-api-secret', '#pinata-jwt'].forEach(sel => {
            const el = $input(sel);
            if (el) {
                el.value = '';
                el.dataset.hasValue = '0';
            }
        });
    } else if (provider === PROVIDER_TYPE_LIGHTHOUSE) {
        ['#lighthouse-api-key', '#lighthouse-jwt'].forEach(sel => {
            const el = $input(sel);
            if (el) {
                el.value = '';
                el.dataset.hasValue = '0';
            }
        });
    } else if (provider === PROVIDER_TYPE_CUSTOM) {
        const el = $input('#custom-auth');
        if (el) {
            el.value = '';
            el.dataset.hasValue = '0';
        }
    }

    refreshSensitiveIndicators();
    showNotification('已清空该 Provider 的密文');
}

async function saveProviderOnly(): Promise<void> {
    const selected = getSelectedProvider();
    const saved = currentIpfsSettings ?? await loadIpfsSettings();
    const next: IpfsSettings = {
        id: 'ipfs',
        provider: selected,       // 只改这个字段
        pinata: saved?.pinata,    // 其余保持原样，不改动、不校验
        lighthouse: saved?.lighthouse,
        custom: saved?.custom,
    };
    await saveIpfsSettings(next);
    currentIpfsSettings = next;
    showNotification('已保存默认 Provider'); // 简短提示
}

function initSecretToggleButtons(): void {
    document.querySelectorAll<HTMLButtonElement>('.secret-toggle').forEach(btn => {
        const selector = btn.dataset.secretTarget;
        if (!selector) return;
        const input = $input(selector);
        if (!input) return;

        btn.addEventListener('click', () => {
            // 未解密但已设置时（只读 + 无 value），不允许直接点眼睛看
            if (input.readOnly && input.dataset.hasValue === '1' && !input.value) {
                showNotification('请先点击对应 Provider 的「解密并回填」按钮', 'info');
                return;
            }

            input.type = input.type === 'password' ? 'text' : 'password';
            btn.classList.toggle('is-visible', input.type === 'text');
        });
    });
}
