import {$Id, $input, showNotification} from "./common";
import {t} from "../common/i18n";
import {
    BASE_MAINNET_CHAIN_ID,
    BASE_MAINNET_DEFAULT_RPC,
    BASE_MAINNET_USDC,
    BASE_SEPOLIA_CHAIN_ID,
    BASE_SEPOLIA_DEFAULT_RPC,
    BASE_SEPOLIA_USDC
} from "../common/consts";
import {defaultWalletSettings, loadWalletSettings, saveWalletSettings, WalletSettings} from "../wallet/wallet_setting";
import {ethers} from "ethers";

type UiNetworkOption = 'base-mainnet' | 'base-sepolia' | 'custom';

export let currentSettings: WalletSettings = {...defaultWalletSettings};

export function setCurrentSettings(settings: WalletSettings): void {
    currentSettings = {...settings};
}

function notifySettingsChanged(): void {
    console.log("------>>> infura setting changed.....");
}

function getChainId(settings: WalletSettings): number {
    return settings.network === 'base-mainnet'
        ? BASE_MAINNET_CHAIN_ID
        : BASE_SEPOLIA_CHAIN_ID;
}

export function getDefaultUsdcAddress(settings: WalletSettings): string {
    return settings.network === 'base-mainnet'
        ? BASE_MAINNET_USDC
        : BASE_SEPOLIA_USDC;
}

export function getRpcEndpoint(settings: WalletSettings): string {
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

export function createProvider(settings: WalletSettings): ethers.providers.JsonRpcProvider {
    const rpcUrl = getRpcEndpoint(settings);
    const chainId = getChainId(settings);
    return new ethers.providers.JsonRpcProvider(rpcUrl, chainId);
}

/**
 * 从 WalletSettings 推导出 UI 下拉应该选哪个：
 * - mainnet → base-mainnet
 * - sepolia 且没有自定义 RPC → base-sepolia
 * - sepolia 且有自定义 RPC（useDefaultRpc === false 且 customRpcUrl 有值）→ custom
 */
export function deriveUiNetwork(settings: WalletSettings): UiNetworkOption {
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
export function applyUiNetworkToForm(uiNetwork: UiNetworkOption, settings: WalletSettings): void {
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

export function updateSettingsUI(settings: WalletSettings): void {
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

async function handleNetworkSelectChange(
    select: HTMLSelectElement,
    refreshBalances: () => Promise<void>,
): Promise<void> {
    const value = select.value as UiNetworkOption;

    if (value === "base-mainnet" || value === "base-sepolia") {
        // === 1) 修改内存中的 WalletSettings ===
        if (value === "base-mainnet") {
            currentSettings = {
                network: "base-mainnet",
                useDefaultRpc: true,
            };
        } else {
            currentSettings = {
                network: "base-sepolia",
                useDefaultRpc: true,
            };
        }
        currentSettings.infuraProjectId = undefined;
        currentSettings.customRpcUrl = undefined;

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

async function handleSaveSettingsClick(
    select: HTMLSelectElement,
    refreshBalances: () => Promise<void>,
): Promise<void> {
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

export async function handleResetSettings(refreshBalances: () => Promise<void>): Promise<void> {
    currentSettings = {...defaultWalletSettings};
    updateSettingsUI(currentSettings);
    await saveWalletSettings(currentSettings);
    showNotification(t('wallet_node_settings_reset'));
    notifySettingsChanged();
    await refreshBalances();
}

function toggleSettingsPanel(): void {
    const panel = $Id("settings-panel") as HTMLDivElement | null;
    if (!panel) return;

    const willOpen = !panel.classList.contains("open");

    if (willOpen) {
        updateSettingsUI(currentSettings);
    }

    panel.classList.toggle("open", willOpen);
    panel.classList.toggle("hidden", !willOpen);
}

interface SettingsPanelOptions {
    onOpenSettings?: () => void;
}

export async function initSettingsPanel(
    refreshBalances: () => Promise<void>,
    options?: SettingsPanelOptions,
): Promise<void> {
    currentSettings = await loadWalletSettings();

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
            handleNetworkSelectChange(networkSelect, refreshBalances).then();
        });
    }

    if (saveBtn && networkSelect) {
        saveBtn.textContent = t('wallet_save_settings');
        saveBtn.addEventListener("click", () => {
            handleSaveSettingsClick(networkSelect, refreshBalances).then();
        });
    }

    const resetBtn = $Id('btn-reset-settings');
    if (resetBtn) {
        resetBtn.textContent = t('wallet_reset_settings');
        resetBtn.addEventListener("click", () => {
            handleResetSettings(refreshBalances).then();
        });
    }

    const openSettingsBtn = document.querySelector<HTMLElement>(
        "#btn-open-settings .wallet-action-inner"
    );
    if (openSettingsBtn) {
        openSettingsBtn.addEventListener("click", (ev) => {
            ev.stopPropagation();
            options?.onOpenSettings?.();
            toggleSettingsPanel();
        });
    }

    updateSettingsUI(currentSettings);
}
