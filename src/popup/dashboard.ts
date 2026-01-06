import browser from "webextension-polyfill";
import {
    __DBK_AD_Block_Key,
    MsgType
} from "../common/consts";
import {checkAndInitDatabase} from "../common/database";
import {sendMessageToX} from "../service_work/bg_msg";
import {localGet, localSet} from "../common/local_storage";
import {getSystemSetting, switchAdOn} from "../object/system_setting";
import {initI18n, t} from "../common/i18n";
import {initDashboardTexts, initWalletOrCreate} from "./dash_wallet";
import {$Id} from "./common";
import {initIpfsSettingsView} from "./dash_ipfs";
import {showView} from "../common/utils";
import {initSettingsPanel} from "./dash_setting";

console.log('------>>>Happy developing ✨')
document.addEventListener("DOMContentLoaded", initDashBoard as EventListener);

let routeTarget = "";

async function initDashBoard(): Promise<void> {
    initI18n();
    initDashboardTexts();
    await checkAndInitDatabase();
    if (routeTarget) {
        showView(routeTarget, dashRouter);
    } else {
        showView('#onboarding/main-home', dashRouter);
    }

    initCatMgmBtn();
    initSettings();
    initWalletOrCreate();
    initIpfsSettingsView();
    await initSettingsPanel();
    initNetworkBadgeSync();

    initBuyUsdcButton();
}

function initBuyUsdcButton() {
    const buyUsdcBtn = document.getElementById("btn-buy-usdc");
    if (buyUsdcBtn) {
        buyUsdcBtn.addEventListener("click", async () => {
            await browser.tabs.create({
                url: browser.runtime.getURL("html/buy_usdc.html")
            });
        });
    }
}


export function dashRouter(path: string): void {
    if (path === '#onboarding/main-home') {
        setHomeStatus().then();
    } else if (path === '#onboarding/category-manager') {
    }
}

function initCatMgmBtn() {
    const mgnCategoryBtn = $Id("btn-mgn-category") as HTMLElement;
    mgnCategoryBtn.innerText = t('manage_category');
    mgnCategoryBtn.onclick = async () => {
        await browser.tabs.create({
            url: browser.runtime.getURL("html/following_mgm.html"),
        })
    }
}

async function setHomeStatus() {
    const isEnabled: boolean = await localGet(__DBK_AD_Block_Key) as boolean ?? false//TODO:: refactor __DBK_AD_Block_Key logic
    const blockAdsToggle = $Id('ad-block-toggle') as HTMLInputElement;
    blockAdsToggle.checked = isEnabled;

    const adNumber = document.querySelector(".number-blocked-txt") as HTMLSpanElement;
    (document.querySelector(".ads-blocked-tips") as HTMLSpanElement).innerText = t('block_ads');
    const setting = await getSystemSetting();
    adNumber.innerText = "" + setting.adsBlocked
}

function initSettings() {
    const blockAdsToggle = $Id('ad-block-toggle') as HTMLInputElement;

    blockAdsToggle.onchange = async () => {
        const isEnabled = blockAdsToggle.checked;
        await localSet(__DBK_AD_Block_Key, isEnabled);
        await switchAdOn(isEnabled);
        await sendMessageToX(MsgType.AdsBlockChanged, isEnabled);
    };
}
function initNetworkBadgeSync() {
    const badgeEl = document.getElementById("wallet-current-network") as HTMLSpanElement | null;
    const selectEl = document.getElementById("wallet-network-select") as HTMLSelectElement | null;
    if (!badgeEl || !selectEl) return;

    const apply = () => {
        const v = (selectEl.value || "").toLowerCase();
        if (v === "base-mainnet") {
            badgeEl.textContent = "Base mainnet";
            return;
        }
        if (v === "base-sepolia") {
            badgeEl.textContent = "Base Sepolia testnet";
            return;
        }
        // fallback：如果未来新增网络，直接用 option 文本
        badgeEl.textContent =
            selectEl.options[selectEl.selectedIndex]?.textContent?.trim() || "Network";
    };

    apply(); // 初始化同步一次（initSettingsPanel 会先把 select.value 设好）
    selectEl.addEventListener("change", apply); // 不覆盖你原来的 onchange
}
