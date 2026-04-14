import {
    exportPrivateKey,
    signMessage, transEthParam,
    transferErc20,
    transferEth, transUsdcParam,
    withDecryptedWallet
} from "../wallet/wallet_api";
import {createWalletSession} from "./session_wallet";
export async function msgUnlockWallet(password: string) {
    try {
        const info = await withDecryptedWallet(password, async (wallet) => {
            await createWalletSession(wallet);
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

export async function msgTransferEth(payload: transEthParam) {
    try {
        const tx = await transferEth(payload)
        return {success: true, txHash: tx};
    } catch (e) {
        return {success: false, error: (e as Error).message};
    }
}

export async function msgTransferUsdc(payload: transUsdcParam) {
    try {
        const tx = await transferErc20(payload)
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