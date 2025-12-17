import browser from "webextension-polyfill";
import {ethers} from "ethers";
import {
    __DBK_AD_Block_Key,
    BASE_MAINNET_CHAIN_ID, BASE_MAINNET_DEFAULT_RPC,
    BASE_MAINNET_USDC,
    BASE_SEPOLIA_CHAIN_ID, BASE_SEPOLIA_DEFAULT_RPC, BASE_SEPOLIA_USDC,
    ERC20_ABI,
    MsgType, X402TaskKey
} from "../common/consts";
import {checkAndInitDatabase} from "../common/database";
import {EncryptedBlock, encryptString, showView} from "../common/utils";
import {sendMessageToX} from "../service_work/bg_msg";
import {localGet, localRemove, localSet} from "../common/local_storage";
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
import {$, $Id, $input, hideLoading, showAlert, showLoading, showNotification} from "./common";
import {
    IpfsProvider,
    IpfsSettings,
    loadIpfsSettings,
    saveIpfsSettings,
    decryptSettingsForUI, PROVIDER_TYPE_PINATA, PROVIDER_TYPE_LIGHTHOUSE, PROVIDER_TYPE_CUSTOM,
    PROVIDER_TYPE_TWEETCAT
} from "../wallet/ipfs_settings";
import {resetIpfsClient} from "../wallet/ipfs_api";
import {requestPassword} from "./password_modal";
import {processX402Task} from "./popup_x402";

type UiNetworkOption = 'base-mainnet' | 'base-sepolia' | 'custom';

type PasswordPrompt = () => Promise<string>;

let currentWallet: TCWallet | null = null;
let currentSettings: WalletSettings = {...defaultWalletSettings};

console.log('------>>>Happy developing ✨')
document.addEventListener("DOMContentLoaded", initDashBoard as EventListener);

let routeTarget = "";

async function initDashBoard(): Promise<void> {
    initI18n();
    initDashboardTexts();
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
    await processX402Task()
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
    // (document.querySelector(".logo-container") as HTMLDivElement).style.display = 'none';
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
    const openSettingsBtn = document.querySelector<HTMLElement>(
        "#btn-open-settings .wallet-action-inner"
    );
    const resetSettingsBtn = $Id("btn-reset-settings") as HTMLButtonElement | null;
    const backBtn = $Id("wallet-back-btn") as HTMLButtonElement | null;


    const walletMainMenu = $Id("wallet-main-menu") as HTMLDivElement | null;
    const closeMainMenu = () => {
        if (walletMainMenu && !walletMainMenu.classList.contains("hidden")) {
            walletMainMenu.classList.add("hidden");
        }
    };

    refreshBtn?.addEventListener("click", () => {
        closeMainMenu();
        refreshBalances().then();
    });
    exportBtn?.addEventListener("click", () => {
        handleExportPrivateKey().then();
    });
    transferEthBtn?.addEventListener("click", () => {
        closeMainMenu();
        handleTransferEth().then();
    });
    transferTokenBtn?.addEventListener("click", () => {
        closeMainMenu();
        handleTransferToken().then();
    });
    signMessageBtn?.addEventListener("click", () => {
        closeMainMenu();
        handleSignMessage().then();
    });
    signTypedBtn?.addEventListener("click", () => {
        closeMainMenu();
        handleSignTypedData().then();
    });
    verifyBtn?.addEventListener("click", () => {
        closeMainMenu();
        handleVerifySignature().then();
    });
    openSettingsBtn?.addEventListener("click", (ev) => {
        ev.stopPropagation();
        closeMainMenu();               // 虽然这个按钮不在下拉菜单里，但多关一次没坏处
        toggleSettingsPanel();
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

    if (infuraInput) {
        infuraInput.value = settings.infuraProjectId ?? "";
    }
    if (customInput) {
        customInput.value = settings.customRpcUrl ?? "";
    }

    // 现在不再使用 rpc-mode 单选按钮，直接通过下拉 + useDefaultRpc 推导
    const networkSelect = $Id("wallet-network-select") as HTMLSelectElement | null;
    if (networkSelect) {
        const uiNetwork = deriveUiNetwork(settings);
        networkSelect.value = uiNetwork;
        applyUiNetworkToForm(uiNetwork, settings);
    }
}

function toggleSettingsPanel(): void {
    const panel = $Id("settings-panel") as HTMLDivElement | null;
    if (!panel) return;

    const willOpen = !panel.classList.contains("open");

    if (willOpen) {
        // 每次打开前，用最新的 WalletSettings 刷一下表单
        updateSettingsUI(currentSettings);
    }

    panel.classList.toggle("open", willOpen);
    panel.classList.toggle("hidden", !willOpen);
}

async function handleResetSettings(): Promise<void> {
    currentSettings = {...defaultWalletSettings};
    updateSettingsUI(currentSettings);
    await saveWalletSettings(currentSettings);
    showNotification(t('wallet_node_settings_reset'));
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
        if (showStatus) showNotification(t('wallet_error_no_wallet'), "error");
        return;
    }

    try {
        if (showStatus) showNotification(t('wallet_refreshing_balance'));
        const provider = createProvider(currentSettings);
        const usdtContract = new ethers.Contract(getDefaultUsdcAddress(currentSettings), ERC20_ABI, provider);

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

        if (showStatus) showNotification(t('wallet_refresh_balance_success'));
    } catch (error) {
        if (showStatus) {
            showNotification((error as Error).message ?? t('wallet_refresh_balance_failed'), "error");
        }
    }
}


function getChainId(settings: WalletSettings): number {
    return settings.network === 'base-mainnet'
        ? BASE_MAINNET_CHAIN_ID
        : BASE_SEPOLIA_CHAIN_ID;
}

function getDefaultUsdcAddress(settings: WalletSettings): string {
    return settings.network === 'base-mainnet'
        ? BASE_MAINNET_USDC
        : BASE_SEPOLIA_USDC;
}

function getRpcEndpoint(settings: WalletSettings): string {
    const net = settings.network; // 只返回 base-mainnet / base-sepolia
    const infuraId = settings.infuraProjectId?.trim();
    const custom = settings.customRpcUrl?.trim();

    // 1) 若 useDefaultRpc === false 且配置了 customRpcUrl，则优先使用自定义 RPC
    if (!settings.useDefaultRpc && custom) {
        return custom;
    }

    // 2) 否则如果配置了 Infura，则用 Infura 节点
    if (infuraId) {
        if (net === 'base-mainnet') {
            return `https://base-mainnet.infura.io/v3/${infuraId}`;
        }
        return `https://base-sepolia.infura.io/v3/${infuraId}`;
    }

    // 3) 最后使用官方公共 RPC
    if (net === 'base-mainnet') {
        return BASE_MAINNET_DEFAULT_RPC;
    }
    return BASE_SEPOLIA_DEFAULT_RPC;
}

function createProvider(settings: WalletSettings): ethers.providers.JsonRpcProvider {
    const rpcUrl = getRpcEndpoint(settings);
    const chainId = getChainId(settings);
    return new ethers.providers.JsonRpcProvider(rpcUrl, chainId);
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
        showNotification(t("wallet_error_no_wallet"), "info");
        return;
    }

    try {
        const privateKey = await withDecryptedWallet(
            () => requestPassword(t("wallet_prompt_password_export_pk")),
            async wallet => wallet.privateKey
        );
        showAlert(t("wallet_export_pk_alert_prefix") + t("wallet_export_pk_warning"), privateKey)
    } catch (error) {
        showNotification((error as Error).message ?? t("wallet_export_pk_failed"), "error");
    }
}

async function handleTransferEth(): Promise<void> {
    if (!currentWallet) {
        showNotification(t("wallet_error_no_wallet"), "info");
        return;
    }

    const formValues = await openTransferEthDialog();
    if (!formValues) {
        return;
    }

    const {to, amount, gas} = formValues;

    try {
        const txHash = await transferEth({
            to,
            amountEther: amount,
            gas,
            passwordPrompt: () => requestPassword(t("wallet_prompt_password_send_eth")),
        });
        showNotification(t("wallet_transfer_tx_sent") + txHash);
        await refreshBalances();
    } catch (error) {
        showNotification(
            (error as Error).message ?? t("wallet_transfer_eth_failed"),
            "error",
        );
    }
}

async function handleTransferToken(): Promise<void> {
    if (!currentWallet) {
        showNotification(t("wallet_error_no_wallet"), "info");
        return;
    }

    const formValues = await openTransferTokenDialog();
    if (!formValues) {
        // 用户取消 / DOM 不完整
        return;
    }

    const {to, amount, decimals, gas} = formValues;
    const tokenAddress = getDefaultUsdcAddress(currentSettings); // 固定用当前网络 USDC

    try {
        const txHash = await transferErc20({
            tokenAddress,
            to,
            amount,
            decimals,
            gas,
            passwordPrompt: () =>
                requestPassword(t("wallet_prompt_password_send_token")),
        });
        showNotification(t("wallet_transfer_token_tx_sent") + txHash);
        await refreshBalances();
    } catch (error) {
        showNotification(
            (error as Error).message ?? t("wallet_transfer_token_failed"),
            "error",
        );
    }
}

async function handleSignMessage(): Promise<void> {
    if (!currentWallet) {
        showNotification(t("wallet_error_no_wallet"), "info");
        return;
    }

    const message = window.prompt(t("wallet_prompt_sign_message"), "");
    if (message === null) return;

    try {
        const signature = await signMessage({
            message,
            passwordPrompt: () => requestPassword(t("wallet_prompt_password_sign_message"))
        });
        showNotification(t("wallet_sign_message_success"));
        window.alert(t("wallet_sign_message_alert_prefix") + signature);
    } catch (error) {
        showNotification((error as Error).message ?? t("wallet_sign_message_failed"), "error");
    }
}

async function handleSignTypedData(): Promise<void> {
    if (!currentWallet) {
        showNotification(t("wallet_error_no_wallet"), "info");
        return;
    }

    const typedInput = window.prompt(t("wallet_prompt_sign_typed_json"), "");
    if (!typedInput) return;

    try {
        const parsed = JSON.parse(typedInput);
        if (!parsed.domain || !parsed.types || !parsed.value) {
            showNotification(t("wallet_error_json_missing_fields"), "error");
            return;
        }
        const signature = await signTypedData({
            domain: parsed.domain,
            types: parsed.types,
            value: parsed.value,
            passwordPrompt: () => requestPassword(t("wallet_prompt_password_sign_typed"))
        });
        showNotification(t("wallet_sign_typed_success"));
        window.alert(t("wallet_sign_message_alert_prefix") + signature);
    } catch (error) {
        const message = error instanceof SyntaxError ? t("wallet_error_json_parse_failed") : (error as Error).message;
        showNotification(message ?? t("wallet_sign_typed_failed"), "error");
    }
}

async function handleVerifySignature(): Promise<void> {
    const signature = window.prompt(t("wallet_prompt_verify_signature_input_signature"), "");
    if (!signature) return;

    const typedInput = window.prompt(t("wallet_prompt_verify_typed_json_or_empty"), "");
    const expected = window.prompt(t("wallet_prompt_verify_expected_address"), currentWallet?.address ?? "") ?? "";

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
            const message = window.prompt(t("wallet_prompt_verify_original_message"), "");
            if (message === null) return;
            result = await verifySignature({
                message,
                signature,
                expectedAddress: expected.trim() || undefined,
            });
        }

        if (typeof result === "boolean") {
            showNotification(result ? t("wallet_verify_success") : t("wallet_verify_failed"), result ? undefined : "error");
        } else {
            showNotification(t("wallet_verify_signer_resolved"));
            window.alert(t("wallet_verify_signer_alert_prefix") + result);
        }
    } catch (error) {
        const message = error instanceof SyntaxError ? t("wallet_error_json_parse_failed") : (error as Error).message;
        showNotification(message ?? t("wallet_verify_failed"), "error");
    }
}



async function withDecryptedWallet<T>(passwordPrompt: PasswordPrompt, action: (wallet: ethers.Wallet) => Promise<T>): Promise<T> {
    if (!currentWallet) {
        throw new Error(t("wallet_error_no_wallet"));
    }
    let wallet: ethers.Wallet | null = null;
    try {
        const password = await passwordPrompt();
        if (!password) {
            throw new Error(t("wallet_error_password_required"));
        }
        showLoading(t("wallet_decrypting"))
        wallet = await ethers.Wallet.fromEncryptedJson(currentWallet.keystoreJson, password);
        return await action(wallet);
    } finally {
        hideLoading()
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
        throw new Error(t("wallet_error_invalid_to_address"));
    }
    if (!amountEther) {
        throw new Error(t("wallet_error_amount_required"));
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
        throw new Error(t("wallet_error_invalid_token_address"));
    }
    if (!ethers.utils.isAddress(to)) {
        throw new Error(t("wallet_error_invalid_to_address"));
    }
    if (!amount) {
        throw new Error(t("wallet_error_amount_required"));
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
        throw new Error(t("wallet_error_message_required"));
    }
    return withDecryptedWallet(passwordPrompt, wallet => wallet.signMessage(message));
}

export async function signTypedData({domain, types, value, passwordPrompt}: SignTypedDataParams): Promise<string> {
    if (!domain || !types || !value) {
        throw new Error(t("wallet_error_typeddata_incomplete"));
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
        throw new Error(t("wallet_error_signature_required"));
    }

    let recovered: string;
    if (message !== undefined) {
        recovered = ethers.utils.verifyMessage(message, signature);
    } else if (typed) {
        recovered = ethers.utils.verifyTypedData(typed.domain, typed.types, typed.value, signature);
    } else {
        throw new Error(t("wallet_error_message_or_typed_required"));
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
        input.placeholder = t('key_tips_has_set');
        input.readOnly = true;
        input.type = "password";
        input.classList.add("has-secret", "secret-readonly");
    } else {
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
    refreshSensitiveIndicators();
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
                showNotification(t('ipfs_error_custom_api_url_required'), 'error');
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
            password = await requestPassword(t('ipfs_prompt_encrypt_password'));
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
                showNotification(t('ipfs_error_pinata_jwt_or_key_required'), 'error');
                return false;
            }
        } else if (provider === PROVIDER_TYPE_LIGHTHOUSE) {
            const l = next.lighthouse ?? {};
            if (!l.jwtEnc && !l.apiKeyEnc) {
                showNotification(t('ipfs_error_lighthouse_api_or_jwt_required'), 'error');
                return false;
            }
        } else if (provider === PROVIDER_TYPE_CUSTOM) {
            if (!next.custom?.apiUrl) {
                showNotification(t('ipfs_error_custom_api_url_required'), 'error');
                return false;
            }
        }

        await saveIpfsSettings(next);
        resetIpfsClient();
        currentIpfsSettings = next;
        showNotification(t('ipfs_save_encrypted_success'), 'info');
        return true;
    } catch (error) {
        const message = (error as Error).message ?? t('ipfs_save_failed');
        showNotification(message, 'error');
        return false;
    }
}

export function initIpfsSettingsView() {
    const ipfsTitle = $Id('ipfs-settings-title');
    if (ipfsTitle) ipfsTitle.textContent = t('ipfs_settings_title');

    const backBtn = $Id('ipfs-back-btn') as HTMLButtonElement | null;
    if (backBtn) {
        const backLabel = t('back');
        backBtn.setAttribute('aria-label', backLabel);
        const backSvg = backBtn.querySelector('svg');
        if (backSvg) {
            backSvg.setAttribute('title', backLabel);
            backSvg.setAttribute('aria-label', backLabel);
        }

        backBtn.addEventListener("click", async () => {
            await saveProviderOnly();
            showView('#onboarding/main-home', dashRouter);
        });
    }

    const providerSelect = $Id('ipfs-provider-select') as HTMLSelectElement | null;
    if (providerSelect) {
        const optPinata = $Id('ipfs-provider-option-pinata');
        if (optPinata) optPinata.textContent = t('ipfs_provider_pinata_option');
        const optLighthouse = $Id('ipfs-provider-option-lighthouse');
        if (optLighthouse) optLighthouse.textContent = t('ipfs_provider_lighthouse_option');
        const optCustom = $Id('ipfs-provider-option-custom');
        if (optCustom) optCustom.textContent = t('ipfs_provider_custom_option');
        const optTweetcat = $Id('ipfs-provider-option-tweetcat');
        if (optTweetcat) optTweetcat.textContent = t('ipfs_provider_tweetcat_option');

        providerSelect.addEventListener('change', () => {
            const value = providerSelect.value as IpfsProvider;
            if (currentIpfsSettings) {
                currentIpfsSettings = {
                    ...currentIpfsSettings,
                    provider: value,
                };
            }
            updateProviderVisibility();
            refreshSensitiveIndicators();
        });
    }

    const sensitiveHint = $Id('ipfs-sensitive-hint');
    if (sensitiveHint) sensitiveHint.textContent = t('ipfs_sensitive_hint');

    const pinataTitle = $Id('ipfs-pinata-section-title');
    if (pinataTitle) pinataTitle.textContent = t('ipfs_pinata_section_title');

    const lighthouseTitle = $Id('ipfs-lighthouse-section-title');
    if (lighthouseTitle) lighthouseTitle.textContent = t('ipfs_lighthouse_section_title');

    const customTitle = $Id('ipfs-custom-section-title');
    if (customTitle) customTitle.textContent = t('ipfs_custom_section_title');

    const linkPinata = $Id('ipfs-link-pinata');
    if (linkPinata) linkPinata.textContent = t('ipfs_link_pinata');

    const linkLighthouse = $Id('ipfs-link-lighthouse');
    if (linkLighthouse) linkLighthouse.textContent = t('ipfs_link_lighthouse');

    const linkDesktop = $Id('ipfs-link-desktop');
    if (linkDesktop) linkDesktop.textContent = t('ipfs_link_desktop');

    const pinataApiKeyLabel = $Id('pinata-api-key-label');
    if (pinataApiKeyLabel) pinataApiKeyLabel.textContent = t('ipfs_pinata_api_key_label');
    const pinataApiKeyInput = $input('#pinata-api-key');
    if (pinataApiKeyInput) pinataApiKeyInput.placeholder = t('ipfs_pinata_api_key_placeholder');

    const pinataSecretLabel = $Id('pinata-api-secret-label');
    if (pinataSecretLabel) pinataSecretLabel.textContent = t('ipfs_pinata_secret_key_label');
    const pinataSecretInput = $input('#pinata-api-secret');
    if (pinataSecretInput) pinataSecretInput.placeholder = t('ipfs_pinata_secret_key_placeholder');

    const pinataJwtLabel = $Id('pinata-jwt-label');
    if (pinataJwtLabel) pinataJwtLabel.textContent = t('ipfs_pinata_jwt_label');
    const pinataJwtInput = $input('#pinata-jwt');
    if (pinataJwtInput) pinataJwtInput.placeholder = t('ipfs_pinata_jwt_placeholder');

    // Lighthouse 表单
    const lighthouseApiKeyLabel = $Id('lighthouse-api-key-label');
    if (lighthouseApiKeyLabel) lighthouseApiKeyLabel.textContent = t('ipfs_lighthouse_api_key_label');
    const lighthouseApiKeyInput = $input('#lighthouse-api-key');
    if (lighthouseApiKeyInput) lighthouseApiKeyInput.placeholder = t('ipfs_lighthouse_api_key_placeholder');

    const lighthouseJwtLabel = $Id('lighthouse-jwt-label');
    if (lighthouseJwtLabel) lighthouseJwtLabel.textContent = t('ipfs_lighthouse_jwt_label');
    const lighthouseJwtInput = $input('#lighthouse-jwt');
    if (lighthouseJwtInput) lighthouseJwtInput.placeholder = t('ipfs_lighthouse_jwt_placeholder');

    const customApiUrlLabel = $Id('custom-api-url-label');
    if (customApiUrlLabel) customApiUrlLabel.textContent = t('ipfs_custom_api_url_label');
    const customApiUrlInput = $input('#custom-api-url');
    if (customApiUrlInput) customApiUrlInput.placeholder = t('ipfs_custom_api_url_placeholder');

    const customGatewayLabel = $Id('custom-gateway-url-label');
    if (customGatewayLabel) customGatewayLabel.textContent = t('ipfs_custom_gateway_url_label');
    const customGatewayInput = $input('#custom-gateway-url');
    if (customGatewayInput) customGatewayInput.placeholder = t('ipfs_custom_gateway_url_placeholder');

    const customAuthLabel = $Id('custom-auth-label');
    if (customAuthLabel) customAuthLabel.textContent = t('ipfs_custom_auth_label');
    const customAuthInput = $input('#custom-auth');
    if (customAuthInput) customAuthInput.placeholder = t('ipfs_custom_auth_placeholder');

    // 打开视图
    $(".ipfs-settings-btn")?.addEventListener("click", async () => {
        await fillIpfsForm();
        showView('#onboarding/ipfs-settings', dashRouter);
    });

    const set_default_node = $Id('ipfs-provider-set-tweetcat');
    set_default_node.textContent = t("use_office_ipfs_node")
    set_default_node?.addEventListener('click', () => {
        setTweetcatAsDefault().then();
    });
    const default_node_noti = $Id('tweetcat-node-notification')
    default_node_noti.textContent = t('default_node_noti')

    const pinata_decrypt_btn = $Id('pinata-reveal-fill')
    pinata_decrypt_btn.textContent = t("decrypt_config")
    pinata_decrypt_btn?.addEventListener('click', () => {
        revealAndFill(PROVIDER_TYPE_PINATA).then();
    });
    const pinata_save_btn = $Id('pinata-save')
    pinata_save_btn.textContent = t("save_config")
    pinata_save_btn?.addEventListener('click', () => {
        saveProviderSecrets(PROVIDER_TYPE_PINATA).then();
    });
    const pinata_clean_btn = $Id('pinata-clear')
    pinata_clean_btn.textContent = t("clean_config")
    pinata_clean_btn?.addEventListener('click', () => {
        clearProviderSecrets(PROVIDER_TYPE_PINATA).then();
    });

    const lighthouse_decrypt_btn = $Id('lighthouse-reveal-fill')
    lighthouse_decrypt_btn.textContent = t("decrypt_config")
    lighthouse_decrypt_btn?.addEventListener('click', () => {
        revealAndFill(PROVIDER_TYPE_LIGHTHOUSE).then();
    });
    const lighthouse_save_btn = $Id('lighthouse-save')
    lighthouse_save_btn.textContent = t("save_config")
    lighthouse_save_btn?.addEventListener('click', () => {
        saveProviderSecrets(PROVIDER_TYPE_LIGHTHOUSE).then();
    });
    const lighthouse_clean_btn = $Id('lighthouse-clear')
    lighthouse_clean_btn.textContent = t("clean_config")
    lighthouse_clean_btn?.addEventListener('click', () => {
        clearProviderSecrets(PROVIDER_TYPE_LIGHTHOUSE).then();
    });

    const custom_decrypt_btn = $Id('custom-reveal-fill')
    custom_decrypt_btn.textContent = t("decrypt_config")
    custom_decrypt_btn?.addEventListener('click', () => {
        revealAndFill(PROVIDER_TYPE_CUSTOM).then();
    });
    const custom_save_btn = $Id('custom-save')
    custom_save_btn.textContent = t("save_config")
    custom_save_btn?.addEventListener('click', () => {
        saveProviderSecrets(PROVIDER_TYPE_CUSTOM).then();
    });
    const custom_clean_btn = $Id('custom-clear')
    custom_clean_btn.textContent = t("clean_config")
    custom_clean_btn?.addEventListener('click', () => {
        clearProviderSecrets(PROVIDER_TYPE_CUSTOM).then();
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
    setSensitiveState($input('#custom-auth'), !!custom?.authEnc);

    // 同时顺手刷一下自建节点的非加密字段
    const apiUrlInput = $input('#custom-api-url');
    if (apiUrlInput) apiUrlInput.value = custom?.apiUrl ?? '';

    const gatewayInput = $input('#custom-gateway-url');
    if (gatewayInput) gatewayInput.value = custom?.gatewayUrl ?? '';
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
    showNotification(t('ipfs_set_tweetcat_default_success'));
}

function fillPlain(selector: string, value: string | undefined) {
    if (!value) return;
    const el = $input(selector);
    if (!el) return;

    el.value = value;
    el.dataset.hasValue = '1';
    el.readOnly = false;
    el.classList.remove('secret-readonly');
}

async function revealAndFill(provider: IpfsProvider): Promise<void> {
    try {

        const savedRaw = currentIpfsSettings ?? await loadIpfsSettings();
        if (!savedRaw) {
            showNotification(t('ipfs_no_saved_settings'), 'info');
            return;
        }
        if (provider === PROVIDER_TYPE_TWEETCAT) {
            showNotification(t('ipfs_tweetcat_no_sensitive_config'), 'info');
            return;
        }

        if (!hasEncryptedSecretsFor(provider, savedRaw)) {
            showNotification(t('ipfs_provider_no_encrypted_fields'), 'info');
            return;
        }

        const password = await requestPassword(t('ipfs_prompt_decrypt_password'));
        const savedForProvider: IpfsSettings = {
            ...savedRaw,
            provider,
        };
        const dec = await decryptSettingsForUI(savedForProvider, password);

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

        showNotification(t('decrypt_info_success'), 'info');
    } catch (e) {
        showNotification(t("decrypt_info_failed") + e.toString(), 'error')
    }
}

async function saveProviderSecrets(_provider: IpfsProvider): Promise<void> {
    await handleIpfsSave(); // 当前分区就是当前 provider，直接保存分支即可
}

async function clearProviderSecrets(provider: IpfsProvider): Promise<void> {
    if (!window.confirm(t('ipfs_confirm_clear_provider_secrets'))) return;

    const saved = currentIpfsSettings ?? await loadIpfsSettings();
    if (!saved) {
        showNotification(t('ipfs_no_saved_settings'), 'info');
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
        showNotification(t('ipfs_tweetcat_no_need_clear'), 'info');
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
    showNotification(t('ipfs_clear_provider_secrets_success'));
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
    showNotification(t('ipfs_save_default_provider_success'));
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
                showNotification(t('ipfs_info_click_decrypt_first'), 'info');
                return;
            }

            input.type = input.type === 'password' ? 'text' : 'password';
            btn.classList.toggle('is-visible', input.type === 'text');
        });
    });
}

function initDashboardTexts(): void {
    // 顶部菜单按钮
    const mainMenuBtn = $Id('btn-main-menu') as HTMLButtonElement | null;
    if (mainMenuBtn) {
        mainMenuBtn.title = t('main_menu_title');
    }

    const walletSettingsBtn = $Id('wallet-settings-btn') as HTMLButtonElement | null;
    if (walletSettingsBtn) {
        const label = t('wallet_settings_title');
        walletSettingsBtn.title = label;
        walletSettingsBtn.setAttribute('aria-label', label);
    }

    // 钱包设置子页标题
    const walletSettingsTitle = $Id('wallet-settings-title');
    if (walletSettingsTitle) {
        walletSettingsTitle.textContent = t('wallet_settings_title');
    }

    // 钱包动作列表
    const signMsgLabel = $Id('wallet-action-sign-message-label');
    if (signMsgLabel) signMsgLabel.textContent = t('wallet_action_sign_message');

    const signTypedLabel = $Id('wallet-action-sign-typed-data-label');
    if (signTypedLabel) signTypedLabel.textContent = t('wallet_action_sign_typed_data');

    const verifySigLabel = $Id('wallet-action-verify-signature-label');
    if (verifySigLabel) verifySigLabel.textContent = t('wallet_action_verify_signature');

    const nodeSettingsLabel = $Id('wallet-action-open-settings-label');
    if (nodeSettingsLabel) nodeSettingsLabel.textContent = t('wallet_action_node_settings');

    // 顶部钱包主菜单四个按钮
    const btnRefresh = $Id('btn-refresh-balance');
    if (btnRefresh) btnRefresh.textContent = t('wallet_action_refresh_balance');

    const btnExportPk = $Id('btn-export-private-key');
    if (btnExportPk) btnExportPk.textContent = t('wallet_action_export_private_key');

    const btnTransferEth = $Id('btn-transfer-eth');
    if (btnTransferEth) btnTransferEth.textContent = t('wallet_action_transfer_eth');

    const btnTransferToken = $Id('btn-transfer-token');
    if (btnTransferToken) btnTransferToken.textContent = t('wallet_action_transfer_token');

    // 网络选择
    const networkTitle = $Id('wallet-network-title');
    if (networkTitle) networkTitle.textContent = t('wallet_network_title');

    const networkSelectLabel = $Id('wallet-network-select-label');
    if (networkSelectLabel) networkSelectLabel.textContent = t('wallet_network_select_label');

    const networkOptionMain = $Id('wallet-network-option-base-mainnet');
    if (networkOptionMain) networkOptionMain.textContent = t('wallet_network_option_base_mainnet');

    const networkOptionSepolia = $Id('wallet-network-option-base-sepolia');
    if (networkOptionSepolia) networkOptionSepolia.textContent = t('wallet_network_option_base_sepolia');

    // 节点与 RPC 设置区
    const nodeRpcTitle = $Id('wallet-node-rpc-title');
    if (nodeRpcTitle) nodeRpcTitle.textContent = t('wallet_node_rpc_title');

    const infuraLabel = $Id('wallet-infura-label');
    if (infuraLabel) infuraLabel.textContent = t('wallet_infura_project_id_label');
    const infuraInput = $input('#infura-project-id');
    if (infuraInput) infuraInput.placeholder = t('wallet_infura_project_id_placeholder');

    const customRpcLabel = $Id('wallet-custom-rpc-label');
    if (customRpcLabel) customRpcLabel.textContent = t('wallet_custom_rpc_url_label');
    const customRpcInput = $input('#custom-rpc-url');
    if (customRpcInput) customRpcInput.placeholder = t('wallet_custom_rpc_url_placeholder');

    const networkSelect = $Id("wallet-network-select") as HTMLSelectElement | null;
    const saveBtn = $Id('btn-save-settings') as HTMLButtonElement | null;

    if (networkSelect) {
        const uiNetwork = deriveUiNetwork(currentSettings);
        networkSelect.value = uiNetwork;
        applyUiNetworkToForm(uiNetwork, currentSettings);

        networkSelect.addEventListener("change", () => {
            handleNetworkSelectChange(networkSelect).then();
        });
    }

    if (saveBtn && networkSelect) {
        saveBtn.textContent = t('wallet_save_settings');
        saveBtn.addEventListener("click", () => {
            handleSaveSettingsClick(networkSelect).then();
        });
    }

    const resetBtn = $Id('btn-reset-settings');
    if (resetBtn) resetBtn.textContent = t('wallet_reset_settings');

    const transferTitle = $Id('transfer-eth-title');
    if (transferTitle) {
        transferTitle.textContent = t('wallet_transfer_eth_title');
    }

    const transferSubtitle = $Id('transfer-eth-subtitle');
    if (transferSubtitle) {
        transferSubtitle.textContent = t('wallet_transfer_eth_subtitle');
    }

    const toLabel = $Id('transfer-eth-to-label');
    if (toLabel) {
        toLabel.textContent = t('wallet_transfer_to_label');
    }
    const toInput = $input('#transfer-eth-to');
    if (toInput) {
        toInput.placeholder = t('wallet_transfer_to_hint');
    }
    const toHint = $Id('transfer-eth-to-hint');
    if (toHint) {
        toHint.textContent = t('wallet_transfer_to_hint');
    }

    const amountLabel = $Id('transfer-eth-amount-label');
    if (amountLabel) {
        amountLabel.textContent = t('wallet_transfer_amount_label');
    }
    const amountInput = $input('#transfer-eth-amount');
    if (amountInput) {
        amountInput.placeholder = t('wallet_transfer_amount_label');
    }

    const feeHint = $Id('transfer-eth-fee-hint');
    if (feeHint) {
        feeHint.textContent = t('wallet_transfer_fee_hint');
    }

    const gasLabel = $Id('transfer-eth-gas-label');
    if (gasLabel) {
        gasLabel.textContent = t('wallet_transfer_gas_label');
    }
    const gasInput = $input('#transfer-eth-gas');
    if (gasInput) {
        gasInput.placeholder = t('wallet_transfer_gas_label');
    }

    const gasHint = $Id('transfer-eth-gas-hint');
    if (gasHint) {
        gasHint.textContent = t('wallet_transfer_gas_hint');
    }

    const submitBtn = $Id('transfer-eth-submit-btn') as HTMLButtonElement | null;
    if (submitBtn) {
        submitBtn.textContent = t('wallet_transfer_confirm_btn');
    }

    const cancelBtn = $Id('transfer-eth-cancel-btn') as HTMLButtonElement | null;
    if (cancelBtn) {
        cancelBtn.textContent = t('cancel');
    }

    // === Token / USDC 转账弹窗文案 ===
    const tokenTitle = $Id('transfer-token-title');
    if (tokenTitle) {
        tokenTitle.textContent = t('wallet_transfer_token_title');
    }

    const tokenSubtitle = $Id('transfer-token-subtitle');
    if (tokenSubtitle) {
        tokenSubtitle.textContent = t('wallet_transfer_token_subtitle');
    }

    const tokenToLabel = $Id('transfer-token-to-label');
    if (tokenToLabel) {
        tokenToLabel.textContent = t('wallet_transfer_to_label');
    }
    const tokenToInput = $input('#transfer-token-to');
    if (tokenToInput) {
        tokenToInput.placeholder = t('wallet_transfer_to_hint');
    }
    const tokenToHint = $Id('transfer-token-to-hint');
    if (tokenToHint) {
        tokenToHint.textContent = t('wallet_transfer_to_hint');
    }

    const tokenAmountLabel = $Id('transfer-token-amount-label');
    if (tokenAmountLabel) {
        tokenAmountLabel.textContent = t('wallet_transfer_token_amount_label');
    }
    const tokenAmountInput = $input('#transfer-token-amount');
    if (tokenAmountInput) {
        tokenAmountInput.placeholder = t('wallet_transfer_token_amount_label');
    }

    const tokenFeeHint = $Id('transfer-token-fee-hint');
    if (tokenFeeHint) {
        tokenFeeHint.textContent = t('wallet_transfer_token_fee_hint');
    }

    const tokenDecimalsLabel = $Id('transfer-token-decimals-label');
    if (tokenDecimalsLabel) {
        tokenDecimalsLabel.textContent = t('wallet_token_decimals_label');
    }

    const tokenGasLabel = $Id('transfer-token-gas-label');
    if (tokenGasLabel) {
        tokenGasLabel.textContent = t('wallet_transfer_gas_label');
    }
    const tokenGasInput = $input('#transfer-token-gas');
    if (tokenGasInput) {
        tokenGasInput.placeholder = t('wallet_transfer_gas_label');
    }

    const tokenGasHint = $Id('transfer-token-gas-hint');
    if (tokenGasHint) {
        tokenGasHint.textContent = t('wallet_transfer_gas_hint');
    }

    const tokenSubmitBtn = $Id('transfer-token-submit-btn') as HTMLButtonElement | null;
    if (tokenSubmitBtn) {
        tokenSubmitBtn.textContent = t('wallet_transfer_token_confirm_btn');
    }

    const tokenCancelBtn = $Id('transfer-token-cancel-btn') as HTMLButtonElement | null;
    if (tokenCancelBtn) {
        tokenCancelBtn.textContent = t('cancel'); // 或 common_cancel
    }

}


/**
 * 从 WalletSettings 推导出 UI 下拉应该选哪个：
 * - mainnet → base-mainnet
 * - sepolia 且没有自定义 RPC → base-sepolia
 * - sepolia 且有自定义 RPC（useDefaultRpc === false 且 customRpcUrl 有值）→ custom
 */
function deriveUiNetwork(settings: WalletSettings): UiNetworkOption {
    if (settings.network === 'base-mainnet') {
        return 'base-mainnet';
    }

    // 其它情况一律视为 base-sepolia 环境
    const hasCustomRpc = !!settings.customRpcUrl && settings.customRpcUrl.trim().length > 0;
    if (!settings.useDefaultRpc && hasCustomRpc) {
        return 'custom';
    }
    return 'base-sepolia';
}

/**
 * 根据 UI 下拉的选项，把「输入框的值/只读状态/保存按钮」同步到 DOM。
 * 注意这里不会改 currentSettings，只是更新表单。
 */
function applyUiNetworkToForm(uiNetwork: UiNetworkOption, settings: WalletSettings): void {
    const infuraInput = document.querySelector<HTMLInputElement>("#infura-project-id");
    const customRpcInput = document.querySelector<HTMLInputElement>("#custom-rpc-url");
    const saveBtn = $Id('btn-save-settings') as HTMLButtonElement | null;

    if (!infuraInput || !customRpcInput) return;

    if (uiNetwork === "base-mainnet") {
        // 主网：使用固定公共 RPC，字段只读、隐藏保存按钮
        infuraInput.value = "";
        customRpcInput.value = BASE_MAINNET_DEFAULT_RPC;
        infuraInput.readOnly = true;
        customRpcInput.readOnly = true;
        if (saveBtn) saveBtn.style.display = "none";
    } else if (uiNetwork === "base-sepolia") {
        // Sepolia：使用固定公共 RPC，字段只读、隐藏保存按钮
        infuraInput.value = "";
        customRpcInput.value = BASE_SEPOLIA_DEFAULT_RPC;
        infuraInput.readOnly = true;
        customRpcInput.readOnly = true;
        if (saveBtn) saveBtn.style.display = "none";
    } else {
        // custom：Base Sepolia + 自定义 RPC，可编辑
        infuraInput.readOnly = false;
        customRpcInput.readOnly = false;
        infuraInput.value = settings.infuraProjectId ?? "";
        customRpcInput.value = settings.customRpcUrl ?? "";
        if (saveBtn) saveBtn.style.display = "";
    }
}

async function handleNetworkSelectChange(select: HTMLSelectElement): Promise<void> {
    const value = select.value as UiNetworkOption;

    if (value === "base-mainnet" || value === "base-sepolia") {
        // === 1) 修改内存中的 WalletSettings ===
        if (value === "base-mainnet") {
            currentSettings.network = "base-mainnet";
        } else {
            currentSettings.network = "base-sepolia";
        }
        currentSettings.infuraProjectId = undefined;
        currentSettings.customRpcUrl = undefined;
        currentSettings.useDefaultRpc = true;

        // === 2) 更新表单显示（只读字段 & 默认 RPC）===
        applyUiNetworkToForm(value, currentSettings);

        // === 3) 持久化设置 & 同步兼容字段 ===
        await saveWalletSettings(currentSettings);
        showNotification(t("save_success"));
        await refreshBalances();
    } else {
        // custom：只更新 UI，不立即保存，等待用户点「保存」按钮
        applyUiNetworkToForm("custom", currentSettings);
    }
}

async function handleSaveSettingsClick(select: HTMLSelectElement): Promise<void> {
    const uiNetwork = select.value as UiNetworkOption;

    // 保险：只有 custom 模式才需要「保存」按钮
    if (uiNetwork !== "custom") {
        return;
    }

    const infuraInput = document.querySelector<HTMLInputElement>("#infura-project-id");
    const customRpcInput = document.querySelector<HTMLInputElement>("#custom-rpc-url");
    if (!infuraInput || !customRpcInput) return;

    const infura = infuraInput.value.trim();
    const customRpc = customRpcInput.value.trim();

    // custom：Base Sepolia + 自定义 RPC
    currentSettings.network = "base-sepolia";
    currentSettings.infuraProjectId = infura || undefined;
    currentSettings.customRpcUrl = customRpc || undefined;
    currentSettings.useDefaultRpc = false;

    await saveWalletSettings(currentSettings);
    showNotification(t("save_success"));
    await refreshBalances();
}

interface TransferEthFormValues {
    to: string;
    amount: string;
    gas?: string;
}

function getReadableNetworkName(): string {
    if (currentSettings.network === "base-mainnet") {
        return t("wallet_network_option_base_mainnet");
    }
    return t("wallet_network_option_base_sepolia");
}

function getCurrentEthBalanceText(): string {
    const span = document.querySelector<HTMLSpanElement>(".wallet-eth-value");
    return span?.textContent?.trim() || "--";
}

/**
 * 打开 ETH 转账表单弹窗，返回用户输入的参数；取消则返回 null。
 */
function openTransferEthDialog(): Promise<TransferEthFormValues | null> {
    const modal = $Id("transfer-eth-modal") as HTMLDivElement | null;

    // 如果还没加 HTML，兜底用旧的 prompt 流程
    if (!modal) {
        return new Promise((resolve) => {
            const to = window.prompt(t("wallet_prompt_transfer_to"), "");
            if (!to) return resolve(null);
            const amount = window.prompt(t("wallet_prompt_transfer_eth_amount"), "");
            if (!amount) return resolve(null);
            const gas = window.prompt(t("wallet_prompt_optional_gas_limit"), "");
            resolve({
                to: to.trim(),
                amount: amount.trim(),
                gas: gas?.trim() || undefined,
            });
        });
    }

    const form = $Id("transfer-eth-form") as HTMLFormElement | null;
    const toInput = $input("#transfer-eth-to");
    const amountInput = $input("#transfer-eth-amount");
    const gasInput = $input("#transfer-eth-gas");
    const errorEl = $Id("transfer-eth-error") as HTMLParagraphElement | null;
    const cancelBtn = $Id("transfer-eth-cancel-btn") as HTMLButtonElement | null;
    const closeBtn = $Id("transfer-eth-close-btn") as HTMLButtonElement | null;
    const maxBtn = $Id("transfer-eth-fill-max") as HTMLButtonElement | null;
    const balanceSpan = $Id("transfer-eth-balance") as HTMLSpanElement | null;
    const networkLabel = $Id("transfer-eth-network-label") as HTMLSpanElement | null;

    if (!form || !toInput || !amountInput || !errorEl) {
        // 结构不完整就直接退出
        return Promise.resolve(null);
    }

    // 初始化展示文案（余额/网络）
    if (balanceSpan) {
        const bal = getCurrentEthBalanceText();
        balanceSpan.textContent = `${t("wallet_current_balance") || ""}：${bal} ETH`;
    }
    if (networkLabel) {
        networkLabel.textContent = getReadableNetworkName();
    }
    if (gasInput) {
        gasInput.value = "";
    }
    toInput.value = "";
    amountInput.value = "";
    errorEl.textContent = "";

    modal.classList.remove("hidden");

    return new Promise<TransferEthFormValues | null>((resolve) => {
        const handleClose = (result: TransferEthFormValues | null) => {
            modal.classList.add("hidden");
            form.removeEventListener("submit", handleSubmit);
            cancelBtn?.removeEventListener("click", handleCancel);
            closeBtn?.removeEventListener("click", handleCancel);
            maxBtn?.removeEventListener("click", handleMax);
            document.removeEventListener("keydown", handleKeydown);
            modal.removeEventListener("click", handleBackdropClick as any);
            resolve(result);
        };

        const handleCancel = () => {
            handleClose(null);
        };

        const handleKeydown = (ev: KeyboardEvent) => {
            if (ev.key === "Escape") {
                ev.preventDefault();
                handleClose(null);
            }
        };

        const handleMax = () => {
            const raw = getCurrentEthBalanceText();
            if (!raw || raw === "--") return;
            const numeric = raw.replace(/,/g, "").split(" ")[0];
            amountInput.value = numeric;
        };

        const handleSubmit = (ev: Event) => {
            ev.preventDefault();
            errorEl.textContent = "";

            const to = toInput.value.trim();
            const amount = amountInput.value.trim();
            const gas = gasInput?.value.trim() || "";

            if (!to) {
                errorEl.textContent = t("wallet_error_to_required");
                return;
            }
            if (!ethers.utils.isAddress(to)) {
                errorEl.textContent = t("wallet_error_invalid_to_address");
                return;
            }
            if (!amount) {
                errorEl.textContent = t("wallet_error_amount_required");
                return;
            }
            const n = Number(amount);
            if (!Number.isFinite(n) || n <= 0) {
                errorEl.textContent =
                    t("wallet_error_amount_invalid") || t("wallet_error_amount_required");
                return;
            }

            if (gas && (!/^\d+$/.test(gas) || Number(gas) < 21000)) {
                errorEl.textContent =
                    t("wallet_error_gas_invalid") || "Gas limit 不合法";
                return;
            }

            handleClose({
                to,
                amount,
                gas: gas || undefined,
            });
        };

        const handleBackdropClick = (ev: MouseEvent) => {
            if (ev.target === modal) {
                handleClose(null);
            }
        };

        form.addEventListener("submit", handleSubmit);
        cancelBtn?.addEventListener("click", handleCancel);
        closeBtn?.addEventListener("click", handleCancel);
        maxBtn?.addEventListener("click", handleMax);
        document.addEventListener("keydown", handleKeydown);
        modal.addEventListener("click", handleBackdropClick);
    });
}

function openTransferTokenDialog(): Promise<TransferTokenFormValues | null> {
    const modal = $Id("transfer-token-modal") as HTMLDivElement | null;
    if (!modal) {
        // 没有 DOM，直接视为取消
        return Promise.resolve(null);
    }

    const form = $Id("transfer-token-form") as HTMLFormElement | null;
    const toInput = $input("#transfer-token-to");
    const amountInput = $input("#transfer-token-amount");
    const decimalsInput = $input("#transfer-token-decimals");
    const gasInput = $input("#transfer-token-gas");
    const errorEl = $Id("transfer-token-error") as HTMLParagraphElement | null;
    const cancelBtn = $Id("transfer-token-cancel-btn") as HTMLButtonElement | null;
    const closeBtn = $Id("transfer-token-close-btn") as HTMLButtonElement | null;
    const maxBtn = $Id("transfer-token-fill-max") as HTMLButtonElement | null;
    const balanceSpan = $Id("transfer-token-balance") as HTMLSpanElement | null;
    const networkLabel = $Id("transfer-token-network-label") as HTMLSpanElement | null;

    if (!form || !toInput || !amountInput || !errorEl) {
        return Promise.resolve(null);
    }

    // 初始化默认值
    toInput.value = "";
    amountInput.value = "";
    if (decimalsInput) {
        decimalsInput.value = "6";
        // USDC 精度固定 6，可以视情况设为只读
        decimalsInput.readOnly = true;
    }
    if (gasInput) {
        gasInput.value = "";
    }
    errorEl.textContent = "";

    if (balanceSpan) {
        const bal = getCurrentTokenBalanceText();
        balanceSpan.textContent = `${t("wallet_current_balance") || ""}：${bal} USDC`;
    }
    if (networkLabel) {
        networkLabel.textContent = getReadableNetworkName();
    }

    modal.classList.remove("hidden");

    return new Promise<TransferTokenFormValues | null>((resolve) => {
        const handleClose = (result: TransferTokenFormValues | null) => {
            modal.classList.add("hidden");
            form.removeEventListener("submit", handleSubmit);
            cancelBtn?.removeEventListener("click", handleCancel);
            closeBtn?.removeEventListener("click", handleCancel);
            maxBtn?.removeEventListener("click", handleMax);
            document.removeEventListener("keydown", handleKeydown);
            modal.removeEventListener("click", handleBackdropClick as any);
            resolve(result);
        };

        const handleCancel = () => {
            handleClose(null);
        };

        const handleKeydown = (ev: KeyboardEvent) => {
            if (ev.key === "Escape") {
                ev.preventDefault();
                handleClose(null);
            }
        };

        const handleMax = () => {
            const raw = getCurrentTokenBalanceText();
            if (!raw || raw === "--") return;
            const numeric = raw.replace(/,/g, "").split(" ")[0];
            amountInput.value = numeric;
        };

        const handleSubmit = (ev: Event) => {
            ev.preventDefault();
            errorEl.textContent = "";

            const to = toInput.value.trim();
            const amount = amountInput.value.trim();
            const gas = gasInput?.value.trim() || "";
            const decimalsRaw = decimalsInput?.value
                ? Number(decimalsInput.value)
                : 6;

            if (!to) {
                errorEl.textContent = t("wallet_error_to_required");
                return;
            }
            if (!ethers.utils.isAddress(to)) {
                errorEl.textContent = t("wallet_error_invalid_to_address");
                return;
            }

            if (!amount) {
                errorEl.textContent = t("wallet_error_amount_required");
                return;
            }
            const n = Number(amount);
            if (!Number.isFinite(n) || n <= 0) {
                errorEl.textContent =
                    t("wallet_error_amount_invalid") || t("wallet_error_amount_required");
                return;
            }

            const decimals =
                Number.isFinite(decimalsRaw) && decimalsRaw > 0
                    ? decimalsRaw
                    : 6;

            if (gas && (!/^\d+$/.test(gas) || Number(gas) < 21000)) {
                errorEl.textContent =
                    t("wallet_error_gas_invalid") || "Gas limit 不合法";
                return;
            }

            handleClose({
                to,
                amount,
                decimals,
                gas: gas || undefined,
            });
        };

        const handleBackdropClick = (ev: MouseEvent) => {
            if (ev.target === modal) {
                handleClose(null);
            }
        };

        form.addEventListener("submit", handleSubmit);
        cancelBtn?.addEventListener("click", handleCancel);
        closeBtn?.addEventListener("click", handleCancel);
        maxBtn?.addEventListener("click", handleMax);
        document.addEventListener("keydown", handleKeydown);
        modal.addEventListener("click", handleBackdropClick);
    });
}

interface TransferTokenFormValues {
    to: string;
    amount: string;
    decimals: number;
    gas?: string;
}


function getCurrentTokenBalanceText(): string {
    const span = document.querySelector<HTMLSpanElement>(".wallet-usdt-value");
    return span?.textContent?.trim() || "--";
}

