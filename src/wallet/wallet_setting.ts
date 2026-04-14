import {
    ChainIDBaseMain,
    ChainIDBaseSepolia,
    ChainNameBaseMain,
    ChainNameBaseSepolia,
    ChainNetwork
} from "../common/x402_obj";
import { __DBK_WALLET_NETWORK_SYNC } from "../common/consts";
import {
    __tableWalletSettings,
    checkAndInitDatabase,
    databaseQueryAll,
    databaseUpdateOrAddItem
} from "../common/database";
import browser from "webextension-polyfill";

export interface WalletSettings {
    useDefaultRpc: boolean;
    network: ChainNetwork;
}

export const WALLET_SETTINGS_KEY = "default_wallet_key";

export const defaultWalletSettings: WalletSettings = {
    useDefaultRpc: true,
    network: ChainNameBaseMain,
};

export async function saveWalletSettings(settings: WalletSettings): Promise<void> {
    const previousSettings = await loadWalletSettings().catch(() => ({ ...defaultWalletSettings }));
    await checkAndInitDatabase();

    const payload = {
        id: WALLET_SETTINGS_KEY,
        useDefaultRpc: settings.useDefaultRpc,
        network: settings.network,
    };

    await databaseUpdateOrAddItem(__tableWalletSettings, payload);

    if (previousSettings.network !== settings.network) {
        await browser.storage.local.set({
            [__DBK_WALLET_NETWORK_SYNC]: {
                network: settings.network,
                changedAt: Date.now(),
            },
        });
    }
}

export async function loadWalletSettings(): Promise<WalletSettings> {
    await checkAndInitDatabase();

    const records = (await databaseQueryAll(__tableWalletSettings)) as Array<WalletSettings & { id: string }>;
    const stored = records.find((item) => item.id === WALLET_SETTINGS_KEY);
    if (!stored) {
        return {...defaultWalletSettings};
    }

    const storedNetwork = (stored as any).network;
    const network: WalletSettings['network'] =
        storedNetwork === ChainNameBaseMain || storedNetwork === ChainNameBaseSepolia
            ? storedNetwork
            : defaultWalletSettings.network;

    return {
        useDefaultRpc: stored.useDefaultRpc ?? defaultWalletSettings.useDefaultRpc,
        network,
    };
}

export async function getChainId(): Promise<number> {
    const settings = await loadWalletSettings()
    return settings.network === ChainNameBaseMain
        ? ChainIDBaseMain
        : ChainIDBaseSepolia;
}
