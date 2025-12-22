import {$Id, $input, showNotification} from "./common";
import {t} from "../common/i18n";

import {defaultWalletSettings, loadWalletSettings, saveWalletSettings, WalletSettings} from "../wallet/wallet_setting";
import {
    BASE_MAINNET_DEFAULT_RPC,
    BASE_SEPOLIA_DEFAULT_RPC,
    ChainIDBaseMain,
    ChainIDBaseSepolia, ChainNameBaseMain, ChainNameBaseSepolia, ChainNetwork
} from "../common/x402_obj";
import {refreshBalances} from "./dash_wallet";


export let currentSettings: WalletSettings = {...defaultWalletSettings};

function notifySettingsChanged(): void {
    console.log("------>>> infura setting changed.....");
}

export function getReadableNetworkName(): string {
    if (currentSettings.network === ChainNameBaseMain) {
        return t("wallet_network_option_base_mainnet");
    }
    return t("wallet_network_option_base_sepolia");
}

export function deriveUiNetwork(settings: WalletSettings): ChainNetwork {
    if (settings.network === ChainNameBaseMain) {
        return ChainNameBaseMain;
    }
    return ChainNameBaseSepolia;
}

export function applyUiNetworkToForm(uiNetwork: ChainNetwork, settings: WalletSettings): void {
    const infuraInput = document.querySelector<HTMLInputElement>("#infura-project-id");
    const customRpcInput = document.querySelector<HTMLInputElement>("#custom-rpc-url");
    const saveBtn = $Id('btn-save-settings') as HTMLButtonElement | null;

    if (!infuraInput || !customRpcInput) return;

    if (uiNetwork === ChainNameBaseMain) {
        // 主网：使用固定公共 RPC，字段只读、隐藏保存按钮
        infuraInput.value = "";
        customRpcInput.value = BASE_MAINNET_DEFAULT_RPC;
        infuraInput.readOnly = true;
        customRpcInput.readOnly = true;
        if (saveBtn) saveBtn.style.display = "none";
    } else if (uiNetwork === ChainNameBaseSepolia) {
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

async function handleNetworkSelectChange(select: HTMLSelectElement): Promise<void> {
    const value = select.value as ChainNetwork;

    if (value === ChainNameBaseMain || value === ChainNameBaseSepolia) {
        // === 1) 修改内存中的 WalletSettings ===
        if (value === ChainNameBaseMain) {
            currentSettings = {
                network: ChainNameBaseMain,
                useDefaultRpc: true,
            };
        } else {
            currentSettings = {
                network: ChainNameBaseSepolia,
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
    }
}

async function handleSaveSettingsClick(
    select: HTMLSelectElement,
    refreshBalances: () => Promise<void>,
): Promise<void> {

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

export async function initSettingsPanel(): Promise<void> {
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
            handleNetworkSelectChange(networkSelect).then();
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
            toggleSettingsPanel();
        });
    }

    updateSettingsUI(currentSettings);
}
