import {ChainNameBaseMain, ChainNameBaseSepolia, ChainNetwork} from "../common/x402_obj";
import {
    __tableWalletSettings,
    checkAndInitDatabase,
    databaseQueryAll,
    databaseUpdateOrAddItem
} from "../common/database";

export interface WalletSettings {
    infuraProjectId?: string;
    customRpcUrl?: string;
    useDefaultRpc: boolean;

    network: ChainNetwork;
}

export const WALLET_SETTINGS_KEY = "default_wallet_key";

export const defaultWalletSettings: WalletSettings = {
    useDefaultRpc: true,
    infuraProjectId: "",
    customRpcUrl: "",
    network: 'base-mainnet',
};

export async function saveWalletSettings(settings: WalletSettings): Promise<void> {
    await checkAndInitDatabase();

    const payload = {
        id: WALLET_SETTINGS_KEY,
        useDefaultRpc: settings.useDefaultRpc,
        infuraProjectId: settings.infuraProjectId?.trim() ?? "",
        customRpcUrl: settings.customRpcUrl?.trim() ?? "",
        network: settings.network,     // ← 新增这一行
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
        infuraProjectId: stored.infuraProjectId ?? "",
        customRpcUrl: stored.customRpcUrl ?? "",
        network,
    };
}

