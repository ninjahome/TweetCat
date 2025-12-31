import {
    ChainIDBaseMain,
    ChainIDBaseSepolia,
    ChainNameBaseMain,
    ChainNameBaseSepolia,
    ChainNetwork
} from "../common/x402_obj";
import {
    __tableWalletSettings,
    checkAndInitDatabase,
    databaseQueryAll,
    databaseUpdateOrAddItem
} from "../common/database";

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
    await checkAndInitDatabase();

    const payload = {
        id: WALLET_SETTINGS_KEY,
        useDefaultRpc: settings.useDefaultRpc,
        network: settings.network,
    };

    await databaseUpdateOrAddItem(__tableWalletSettings, payload);
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