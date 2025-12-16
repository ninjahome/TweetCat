import {showAlert} from "./common";
import {openPasswordModal} from "./password_modal";
import {logX402} from "../common/debug_flags";
import {t} from "../common/i18n";
import {
    StoredX402Session, X402_SCOPE, X402_SESSION_AUTH_DOMAIN, X402_SESSION_AUTH_TYPES,
    X402_SESSION_STORE_KEY,
    X402SessionAuthorization,
    X402SessionKey
} from "../common/x402_obj";
import {ethers} from "ethers";
import {withDecryptedWallet} from "../wallet/wallet_api";
import {localGet, localSet} from "../common/local_storage";


export async function handleX402SessionCreate() {
    // 1️⃣ 让用户解锁主钱包（只这一次）
    const password = await openPasswordModal("创建 x402 Session（仅一次）")
    if (!password) return

    // Base Sepolia / Base Mainnet 自己切
    const chainId = 84532
    const maxAmount = "10000000" // 10 USDC（6 decimals）
    const ttlSeconds = 15 * 60

    await withDecryptedWallet(password, async (ownerWallet) => {
        // 2️⃣ 创建 session key（明文）
        const sessionWallet = ethers.Wallet.createRandom()

        const now = Math.floor(Date.now() / 1000)

        const session: X402SessionKey = {
            address: sessionWallet.address,
            privateKey: sessionWallet.privateKey,
            chainId,
            expiresAt: Date.now() + ttlSeconds * 1000,
            maxTotalAmount: maxAmount,
            spentAmount: "0",
        }

        const authPayload = {
            owner: ownerWallet.address,
            sessionKey: session.address,
            scope: X402_SCOPE,
            chainId,
            maxAmount,
            validAfter: now,
            validBefore: now + ttlSeconds,
        }

        // 4️⃣ 主钱包 EIP-712 签名（唯一一次）
        const signature = await ownerWallet._signTypedData(
            X402_SESSION_AUTH_DOMAIN(chainId),
            X402_SESSION_AUTH_TYPES,
            authPayload
        )

        // ✅ 唯一需要改的地方就在这
        const authorization: X402SessionAuthorization = {
            payload: authPayload,
            signature,
        }
        // 5️⃣ 持久化
        await saveX402Session(session, authorization)

        showAlert(
            "x402 Session 已创建",
            "15 分钟内可免弹窗打赏"
        )
    })
}

async function saveX402Session(
    session: X402SessionKey,
    authorization: X402SessionAuthorization
) {
    const store =
        (await localGet(X402_SESSION_STORE_KEY)) as Record<string, StoredX402Session> | null

    const next = {
        ...(store ?? {}),
        [session.address.toLowerCase()]: {
            session,
            authorization,
            createdAt: Date.now(),
        },
    }

    await localSet(X402_SESSION_STORE_KEY, next)
}
