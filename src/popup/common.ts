import { t } from "../common/i18n";
import browser from "webextension-polyfill";
import { getChainId } from "../wallet/wallet_setting";
import { initCDP, X402_FACILITATORS } from "../common/x402_obj";
import { getCurrentUser } from "@coinbase/cdp-core";
import { getEOA } from "../wallet/cdp_wallet";

let notificationTimer: number | null = null;
let notificationBar: HTMLDivElement | null = null;

export function showNotification(message: string, type: "info" | "error" | "success" = "info", duration = 4000) {
    if (!notificationBar) notificationBar = document.getElementById("notification") as HTMLDivElement | null;

    if (!notificationBar) return;
    notificationBar.textContent = message;
    notificationBar.classList.remove("hidden", "info", "error", "success");
    notificationBar.classList.add(type);
    if (notificationTimer) {
        window.clearTimeout(notificationTimer);
        notificationTimer = null;
    }
    if (duration > 0 && message) {
        notificationTimer = window.setTimeout(() => {
            hideNotification();
        }, duration);
    }
}

export function hideNotification() {
    if (!notificationBar) notificationBar = document.getElementById("notification") as HTMLDivElement | null;

    if (!notificationBar) return;

    notificationBar.textContent = "";
    notificationBar.classList.add("hidden");
    notificationBar.classList.remove("info", "error", "success");
    if (notificationTimer) {
        window.clearTimeout(notificationTimer);
        notificationTimer = null;
    }
}

export function showLoading(msg: string = "") {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
        overlay.style.display = 'flex';
    }
    if (!msg) return
    overlay.querySelector(".loading-message").textContent = msg;
}

export function hideLoading() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
        overlay.style.display = 'none';
    }
}

export function $Id(id: string) {
    return document.getElementById(id) as HTMLElement | null;
}

export function $(sel: string) {
    return document.querySelector(sel) as HTMLElement | null;
}

export function $2<T extends Element>(root: ParentNode, selector: string): T {
    const el = root.querySelector<T>(selector);
    if (!el) throw new Error(`Element not found: ${selector}`);
    return el;
}

export function cloneTemplate(id: string): HTMLElement {
    const tpl = document.querySelector<HTMLTemplateElement>(`#${id}`);
    if (!tpl) throw new Error(`Template not found: #${id}`);
    const first = tpl.content.firstElementChild as HTMLElement | null;
    if (!first) throw new Error(`Template #${id} has no root element`);
    return first.cloneNode(true) as HTMLElement;
}

export function formatUSDC(amount: number): string {
    const n = Number(amount);
    if (!Number.isFinite(n)) return "0.00 USDC";
    return n.toFixed(2) + " USDC";
}

export function $input(sel: string) {
    return document.querySelector(sel) as HTMLInputElement | null;
}

export function showAlert(title: string, message: string) {
    const alertBox = $Id('custom-alert');
    const alertTitle = $Id('alert-title');
    const alertMessage = $Id('alert-message');
    const alertOk = $Id('alert-ok');

    if (!alertBox || !alertTitle || !alertMessage || !alertOk) {
        console.error('Alert elements not found.');
        return;
    }

    // 设置标题和消息
    alertTitle.textContent = title;
    alertMessage.textContent = message;
    alertOk.textContent = t('ok');

    // 显示弹窗
    alertBox.style.display = 'block';

    // 按下 OK 按钮后隐藏
    alertOk.onclick = () => {
        alertBox.style.display = 'none';
    };
}

export function showConfirm(msg: string): Promise<boolean> {
    return new Promise((resolve) => {
        const container = document.getElementById("confirm-popup")!;
        container.style.display = 'block';

        (container.querySelector(".confirm-message") as HTMLElement).innerText = msg;

        const cancelBtn = container.querySelector(".btn-cancel") as HTMLElement;
        cancelBtn.innerText = t("cancel");
        cancelBtn.onclick = () => {
            container.style.display = 'none';
            resolve(false);
        };

        const okBtn = container.querySelector(".btn-ok") as HTMLElement;
        okBtn.innerText = t("confirm");
        okBtn.onclick = () => {
            container.style.display = 'none';
            resolve(true);
        };
    });
}

export async function showPopupWindow(url: string, width: number = 450, height: number = 650) {

    const currentWindow = await browser.windows.getLastFocused();

    let left = 0;
    let top = 0;

    if (currentWindow.width && currentWindow.height) {
        left = Math.round(currentWindow.left! + (currentWindow.width - width) / 2);
        top = Math.round(currentWindow.top! + (currentWindow.height - height) / 2);
    }

    await browser.windows.create({
        url,
        type: 'popup',
        width,
        height,
        left,
        top,
        focused: true
    });
}

export const FIXED_ETH_TRANSFER_GAS_ETH = 0.000002; // ETH转账所需Gas费
export const FIXED_MINI_USDC_TRANSFER = 0.00001; // USDC转账所需Gas费

/**
 * 将原子单位数值转换为 USDC 数字
 * @param atomic - 原子单位的字符串表示（精度为 6）
 * @returns 转换后的 USDC 数字，如果输入无效则返回 0
 * @example
 * atomicToUsdcNumber("1000000") => 1
 * atomicToUsdcNumber("1500000") => 1.5
 * atomicToUsdcNumber("0") => 0
 */
export function atomicToUsdcNumber(atomic: string): number {
    if (!/^\d+$/.test(atomic)) return 0;
    const big = BigInt(atomic);
    const whole = big / 1_000_000n;
    const fraction = (big % 1_000_000n).toString().padStart(6, "0");
    return Number(`${whole}.${fraction}`);
}

/**
 * 两个原子单位数值相乘
 * @param unitAtomic - 单位价格（原子单位）
 * @param quota - 数量
 * @returns 乘积的字符串表示（原子单位）
 * @example
 * multiplyAtomic("1000000", 10) => "10000000"
 */
export function multiplyAtomic(unitAtomic: string, quota: number): string {
    return (BigInt(unitAtomic) * BigInt(quota)).toString();
}

/**
 * 将 USDC 金额转换为原子单位
 * @param amountStr - USDC 金额的字符串表示
 * @returns 转换后的原子单位字符串，如果输入无效则返回 null
 * @example
 * usdcToAtomic("1") => "1000000"
 * usdcToAtomic("1.5") => "1500000"
 * usdcToAtomic("0.000001") => "1"
 * usdcToAtomic("invalid") => null
 */
export function usdcToAtomic(amountStr: string): string | null {
    const s = (amountStr ?? "").trim();
    if (!/^\d+(\.\d{0,6})?$/.test(s)) return null;

    const [intPart, frac = ""] = s.split(".");
    const fracPadded = (frac + "000000").slice(0, 6);
    const out = (intPart.replace(/^0+(?=\d)/, "") || "0") + fracPadded;
    return out.replace(/^0+(?=\d)/, "") || "0";
}

/**
 * 获取当前登录用户的信息
 * @returns 用户的 X ID 和 EOA 钱包地址
 * @throws 如果用户未登录或获取信息失败
 * @example
 * const { xId, walletAddress } = await getCurrentUserInfo();
 */
export async function getCurrentUserInfo(): Promise<{ xId: string; walletAddress: string }> {

    await initCDP();

    const user = await getCurrentUser();
    if (!user) {
        throw new Error("Please sign in first");
    }

    const xId = user?.authenticationMethods?.x?.sub;
    if (!xId) {
        throw new Error("X account not connected. Please sign in with X");
    }

    const eoa = await getEOA();
    if (!eoa?.address) {
        throw new Error("Wallet not found. Please create a wallet first");
    }

    return {
        xId,
        walletAddress: eoa.address,
    };
}


export async function openTxInExplorer(txHash: string, chainId?: number): Promise<void> {
    try {

        if (!txHash) return;
        const normalizedHash = txHash.trim();

        let resolvedChainId = chainId;
        if (!resolvedChainId) {
            try {
                resolvedChainId = await getChainId();
            } catch {
                // ignore: fallback to a generic explorer below
            }
        }

        const browserBase = resolvedChainId ? X402_FACILITATORS[resolvedChainId]?.browser : undefined;
        const url = browserBase
            ? `${browserBase}/tx/${normalizedHash}`
            : `https://blockscan.com/tx/${normalizedHash}`;
        await browser.tabs.create({ url });
    } catch (e) {
        console.error("openTxInExplorer error:", e);
    }
}
