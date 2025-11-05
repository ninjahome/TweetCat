import {
    __tableWalletSettings,
    __tableWallets,
    checkAndInitDatabase,
    databaseDelete,
    databaseQueryAll,
    databaseUpdateOrAddItem
} from "../common/database";

export interface TCWallet {
    address: string;
    keystoreJson: string;
    createdAt: number;
}

export interface WalletSettings {
    infuraProjectId?: string;
    customRpcUrl?: string;
    useDefaultRpc: boolean;
}

const WALLET_SETTINGS_KEY = "default";

export const defaultWalletSettings: WalletSettings = {
    useDefaultRpc: true,
    infuraProjectId: "",
    customRpcUrl: "",
};

export async function saveWallet(record: TCWallet): Promise<void> {
    await checkAndInitDatabase();

    const normalizedAddress = record.address.toLowerCase();
    const payload = {
        address: normalizedAddress,
        keystoreJson: record.keystoreJson,
        createdAt: record.createdAt ?? Date.now(),
    };

    const existing = await databaseQueryAll(__tableWallets);
    await Promise.all(
        existing
            .filter(item => item.address !== normalizedAddress)
            .map(item => databaseDelete(__tableWallets, item.address))
    );

    await databaseUpdateOrAddItem(__tableWallets, payload);
}

export async function loadWallet(): Promise<TCWallet | null> {
    await checkAndInitDatabase();

    const records = await databaseQueryAll(__tableWallets) as TCWallet[];
    if (!records || records.length === 0) {
        return null;
    }

    const sorted = [...records].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    const latest = sorted[0];

    return {
        address: latest.address,
        keystoreJson: latest.keystoreJson,
        createdAt: latest.createdAt ?? Date.now(),
    };
}

export async function clearWallet(address?: string): Promise<void> {
    await checkAndInitDatabase();
    if (address) {
        await databaseDelete(__tableWallets, address.toLowerCase());
        return;
    }

    const records = await databaseQueryAll(__tableWallets);
    await Promise.all(records.map(item => databaseDelete(__tableWallets, item.address)));
}

export async function loadWalletSettings(): Promise<WalletSettings> {
    await checkAndInitDatabase();

    const records = await databaseQueryAll(__tableWalletSettings) as Array<WalletSettings & { id: string }>;
    const stored = records.find(item => item.id === WALLET_SETTINGS_KEY);

    if (!stored) {
        return {...defaultWalletSettings};
    }

    return {
        useDefaultRpc: stored.useDefaultRpc ?? defaultWalletSettings.useDefaultRpc,
        infuraProjectId: stored.infuraProjectId ?? "",
        customRpcUrl: stored.customRpcUrl ?? "",
    };
}

export async function saveWalletSettings(settings: WalletSettings): Promise<void> {
    await checkAndInitDatabase();

    const payload = {
        id: WALLET_SETTINGS_KEY,
        useDefaultRpc: settings.useDefaultRpc,
        infuraProjectId: settings.infuraProjectId?.trim() ?? "",
        customRpcUrl: settings.customRpcUrl?.trim() ?? "",
    };

    await databaseUpdateOrAddItem(__tableWalletSettings, payload);
}
