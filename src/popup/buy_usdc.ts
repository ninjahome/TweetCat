import browser from "webextension-polyfill";
import {getWalletAddress, queryCdpUserID, queryCdpWalletInfo} from "../wallet/cdp_wallet";
import {showLoading, hideLoading, showNotification, x402WorkerFetch} from "./common";
import {getChainId} from "../wallet/wallet_setting";
import {initI18n, t} from "../common/i18n";

interface OnrampSessionResponse {
    success: boolean;
    data?: {
        onrampUrl: string;
        sessionToken?: string;
    };
    error?: string;
}

let selectedAmount = 50; // 默认金额

document.addEventListener("DOMContentLoaded", () => {
    initI18n();
    initBuyUsdcTexts();
    initBuyUsdcPage().then();
});

function initBuyUsdcTexts() {
    // 页面标题
    document.title = t('buy_usdc_title') || 'Buy USDC';
    const pageTitle = document.getElementById('buy-usdc-title');
    if (pageTitle) {
        pageTitle.textContent = t('buy_usdc_title') || 'Buy USDC';
    }

    // 标签
    const labelWallet = document.getElementById('label-your-wallet');
    if (labelWallet) {
        labelWallet.textContent = t('buy_usdc_your_wallet') || 'Your Wallet';
    }

    const labelBalance = document.getElementById('label-current-balance');
    if (labelBalance) {
        labelBalance.textContent = t('buy_usdc_current_balance') || 'Current Balance';
    }

    const labelSelectAmount = document.getElementById('label-select-amount');
    if (labelSelectAmount) {
        labelSelectAmount.textContent = t('buy_usdc_select_amount') || 'Select Amount';
    }

    const labelCustomAmount = document.getElementById('label-custom-amount');
    if (labelCustomAmount) {
        labelCustomAmount.textContent = t('buy_usdc_custom_amount') || 'Or enter custom amount ($5 - $500)';
    }

    // 特性
    const featureNoFees = document.getElementById('feature-no-fees');
    if (featureNoFees) {
        featureNoFees.textContent = t('buy_usdc_no_fees') || 'No Fees on Base Network';
    }

    const featureFastPayment = document.getElementById('feature-fast-payment');
    if (featureFastPayment) {
        featureFastPayment.textContent = t('buy_usdc_fast_payment') || 'Apple Pay & Debit Card';
    }

    const featureSecure = document.getElementById('feature-secure');
    if (featureSecure) {
        featureSecure.textContent = t('buy_usdc_secure') || 'Secured by Coinbase';
    }

    // 按钮
    const btnBuyText = document.getElementById('btn-buy-text');
    if (btnBuyText) {
        btnBuyText.textContent = t('buy_usdc_button') || 'Buy USDC Now';
    }

    // 说明
    const poweredBy = document.getElementById('powered-by');
    if (poweredBy) {
        poweredBy.textContent = t('buy_usdc_powered_by') || 'Powered by Coinbase Onramp';
    }

    const fundsDirect = document.getElementById('funds-direct');
    if (fundsDirect) {
        fundsDirect.textContent = t('buy_usdc_funds_direct') || 'Funds will be sent directly to your wallet';
    }
}

async function initBuyUsdcPage() {
    // 返回按钮
    const backBtn = document.getElementById("buy-back-btn");
    if (backBtn) {
        backBtn.addEventListener("click", () => {
            window.history.back();
        });
    }

    // 加载用户钱包信息
    await loadWalletInfo();

    // 金额选择按钮
    const amountButtons = document.querySelectorAll(".amount-btn");
    amountButtons.forEach(btn => {
        btn.addEventListener("click", (e) => {
            const target = e.currentTarget as HTMLButtonElement;
            const amount = parseInt(target.dataset.amount || "50");
            selectAmount(amount);
            
            // 更新选中状态
            amountButtons.forEach(b => b.classList.remove("selected"));
            target.classList.add("selected");

            // 清空自定义输入
            const customAmountInput = document.getElementById("custom-amount") as HTMLInputElement;
            if (customAmountInput) {
                customAmountInput.value = "";
            }
        });
    });

    // 自定义金额输入
    const customAmountInput = document.getElementById("custom-amount") as HTMLInputElement;
    if (customAmountInput) {
        customAmountInput.addEventListener("input", (e) => {
            const target = e.target as HTMLInputElement;
            const amount = parseInt(target.value);
            if (amount >= 5 && amount <= 500) {
                selectAmount(amount);
                // 取消预设按钮选中
                amountButtons.forEach(b => b.classList.remove("selected"));
            }
        });
    }

    // 购买按钮
    const buyNowBtn = document.getElementById("btn-buy-now");
    if (buyNowBtn) {
        buyNowBtn.addEventListener("click", handleBuyNow);
    }

    // 默认选中 $50
    const defaultBtn = document.querySelector('[data-amount="50"]');
    if (defaultBtn) {
        (defaultBtn as HTMLElement).click();
    }
}

async function loadWalletInfo() {
    try {
        const walletAddress = await getWalletAddress();
        if (!walletAddress) {
            showNotification(t('buy_usdc_no_wallet') || "Please connect your wallet first", "error");
            setTimeout(() => window.history.back(), 2000);
            return;
        }

        const walletEl = document.getElementById("user-wallet");
        if (walletEl) {
            walletEl.textContent = `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`;
        }

        const chainId = await getChainId();
        const walletInfo = await queryCdpWalletInfo(chainId);
        
        const balanceEl = document.getElementById("current-balance");
        if (balanceEl && walletInfo.hasCreated) {
            balanceEl.textContent = `${walletInfo.usdcVal} USDC`;
        }
    } catch (error) {
        console.error("Load wallet info failed:", error);
        showNotification(t('buy_usdc_load_wallet_failed') || "Failed to load wallet info", "error");
    }
}

function selectAmount(amount: number) {
    selectedAmount = amount;
    console.log("Selected amount:", amount);
}

async function handleBuyNow() {
    if (selectedAmount < 5 || selectedAmount > 500) {
        showNotification(t('buy_usdc_amount_error') || "Amount must be between $5 and $500", "error");
        return;
    }

    showLoading(t('buy_usdc_preparing') || "Preparing your purchase...");

    try {
        const walletAddress = await getWalletAddress();
        if (!walletAddress) {
            showNotification(t('buy_usdc_no_wallet_address') || "Wallet address not found", "error");
            return;
        }

        const cdpUserId = await queryCdpUserID();
        if (!cdpUserId) {
            showNotification(t('buy_usdc_no_user_id') || "User ID not found", "error");
            return;
        }

        // 调用后端生成 Onramp URL
        const response: OnrampSessionResponse = await x402WorkerFetch("/onramp/create_session", {
            cdp_user_id: cdpUserId,
            destination_address: walletAddress,
            amount: selectedAmount.toString(),
            asset: "USDC",
            blockchain: "base"
        });

        if (response.success && response.data) {
            // 打开 Coinbase Pay 页面
            await browser.tabs.create({
                url: response.data.onrampUrl
            });

            // 显示提示
            showNotification(t('buy_usdc_redirecting') || "Redirecting to Coinbase Pay...", "success");
            
            // 等待一会后返回
            setTimeout(() => {
                window.history.back();
            }, 2000);
        } else {
            showNotification(response.error || t('buy_usdc_session_failed') || "Failed to create purchase session", "error");
        }
    } catch (error) {
        console.error("Buy USDC failed:", error);
        showNotification(
            t('buy_usdc_failed') || "Failed to initialize purchase" + ": " + (error as Error).message, 
            "error"
        );
    } finally {
        hideLoading();
    }
}
