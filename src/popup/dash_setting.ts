import { $Id, showNotification, showConfirm } from "./common";
import { t } from "../common/i18n";

import { defaultWalletSettings, loadWalletSettings, saveWalletSettings, WalletSettings } from "../wallet/wallet_setting";
import { ChainNameBaseMain, ChainNetwork, doSignOut } from "../common/x402_obj";
import { refreshBalances } from "./dash_wallet";


export let currentSettings: WalletSettings = { ...defaultWalletSettings };

export function getReadableNetworkName(): string {
    if (currentSettings.network === ChainNameBaseMain) {
        return t("wallet_network_option_base_mainnet");
    }
    return t("wallet_network_option_base_sepolia");
}

export async function handleResetSettings(): Promise<void> {
    const confirmed = await showConfirm(t("wallet_network_change_confirm") || "切换网络将退出当前 Coinbase 账号以重新确认绑定关系，确定要重置吗？");
    if (!confirmed) return;

    currentSettings = { ...defaultWalletSettings };
    ($Id("wallet-network-select") as HTMLSelectElement).value = currentSettings.network;
    await saveWalletSettings(currentSettings);
    await doSignOut();
    showNotification(t('wallet_network_changed_relogin') || "网络已切换，请重新登录 Coinbase 账号");
    location.reload();
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
    const networkSelect = $Id("wallet-network-select") as HTMLSelectElement | null;
    if (networkSelect) {
        networkSelect.value = currentSettings.network
        networkSelect.onchange = async () => {
            const confirmed = await showConfirm(t("wallet_network_change_confirm") || "切换网络将退出当前 Coinbase 账号以重新确认绑定关系，确定要切换吗？");
            if (!confirmed) {
                networkSelect.value = currentSettings.network;
                return;
            }

            currentSettings = { network: networkSelect.value as ChainNetwork, useDefaultRpc: true };
            await saveWalletSettings(currentSettings);
            await doSignOut();
            showNotification(t("wallet_network_changed_relogin") || "网络已切换，请重新登录 Coinbase 账号");
            location.reload();
        }
    }

    const resetBtn = $Id('btn-reset-settings');
    if (resetBtn) {
        resetBtn.textContent = t('wallet_reset_settings');
        resetBtn.addEventListener("click", () => {
            handleResetSettings().then();
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
