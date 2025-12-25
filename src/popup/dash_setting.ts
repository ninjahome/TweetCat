import {$Id, showNotification} from "./common";
import {t} from "../common/i18n";

import {defaultWalletSettings, loadWalletSettings, saveWalletSettings, WalletSettings} from "../wallet/wallet_setting";
import {ChainNameBaseMain, ChainNetwork} from "../common/x402_obj";
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

export async function handleResetSettings(refreshBalances: () => Promise<void>): Promise<void> {
    currentSettings = {...defaultWalletSettings};
    ($Id("wallet-network-select") as HTMLSelectElement).value = currentSettings.network;
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
        ($Id("wallet-network-select") as HTMLSelectElement).value = currentSettings.network;
    }

    panel.classList.toggle("open", willOpen);
    panel.classList.toggle("hidden", !willOpen);
}

export async function initSettingsPanel(): Promise<void> {
    currentSettings = await loadWalletSettings();
    console.log("------>>> current settings", currentSettings);
    const networkSelect = $Id("wallet-network-select") as HTMLSelectElement | null;
    if (networkSelect) {
        networkSelect.value = currentSettings.network
        networkSelect.onchange = async () => {
            currentSettings = {network: networkSelect.value as ChainNetwork, useDefaultRpc: true};
            await saveWalletSettings(currentSettings);
            showNotification(t("save_success"));
            await refreshBalances();
            console.log("------>>> wallet settings changed:", currentSettings);
        }
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
    ($Id("wallet-network-select") as HTMLSelectElement).value = currentSettings.network;
}
