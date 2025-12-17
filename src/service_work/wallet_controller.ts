import {
    exportPrivateKey,
    signMessage,
    transferErc20,
    transferEth,
    withDecryptedWallet
} from "../wallet/wallet_api";

export async function msgUnlockWallet(password: string) {
    try {
        const info = await withDecryptedWallet(password, async (wallet) => {
            return wallet.address
        });
        return {success: true, data: info};
    } catch (e) {
        return {success: false, error: (e as Error).message};
    }
}

export async function msgSignMsg(payload: any) {
    const {message, password} = payload
    try {
        const sig = await signMessage({message, password})
        return {success: true, signature: sig};
    } catch (e) {
        return {success: false, error: (e as Error).message};
    }
}

export async function msgTransferEth(payload: any) {
    const {to, amountEther, gas, password} = payload;
    try {
        const tx = await transferEth({to, amountEther, password, gasLimitWei: gas})
        return {success: true, txHash: tx};
    } catch (e) {
        return {success: false, error: (e as Error).message};
    }
}

export async function msgTransferUsdc(payload: any) {
    const {
        tokenAddress,
        to,
        amount,
        decimals,
        gas,
        password
    } = payload;

    try {
        const tx = await transferErc20({tokenAddress, to, amount, decimals, password, gasLimitWei: gas})
        return {success: true, txHash: tx};
    } catch (e) {
        return {success: false, error: (e as Error).message};
    }
}

export async function msgExportPriKye(password: string) {
    try {
        const priKey = await exportPrivateKey(password);
        return {success: true, privateKey: priKey};
    } catch (e) {
        return {success: false, error: (e as Error).message};
    }
}