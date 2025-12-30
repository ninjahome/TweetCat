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
import {queryCdpUserID} from "../wallet/cdp_wallet";
import {x402WorkerGet} from "./common";

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
    await initRewards();
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

// 奖励数据接口
 interface ValidRewardsResponse {
    success: boolean;
    data: {
        rewards: Array<{
            id: number;
            cdp_user_id: string;
            asset_symbol: string;
            amount_atomic: string;
            status: number;
            [key: string]: any;
        }>;
        totalAmount: string;
        count: number;
    };
}

async function initRewards(): Promise<void> {
    try {
        const cdpUserId = await queryCdpUserID();
        if (!cdpUserId) {
            return;
        }

        const response: ValidRewardsResponse = await x402WorkerGet("/rewards/query_valid", {
            cdp_user_id: cdpUserId
        });

        if (response.success && response.data) {
            const { rewards } = response.data;
            const rewardsArea = $Id("rewards-area") as HTMLElement;
            const rewardsCount = rewardsArea.querySelector(".rewards-count") as HTMLElement;
            const rewardsAmount = rewardsArea.querySelector(".rewards-amount") as HTMLElement;

            // 计算 USDC 总额
            let totalUSDC = 0;
            rewards.forEach(reward => {
                if (reward.asset_symbol === "USDC") {
                    totalUSDC += Number(reward.amount_atomic) / 1e6; // 精度为6
                }
            });

            // 更新界面
            rewardsCount.textContent = rewards.length.toString();
            rewardsAmount.textContent = totalUSDC.toFixed(2);
            rewardsArea.style.display = "block";

            // 绑定点击事件
            rewardsArea.onclick = async () => {
                const status = rewards.length > 0 ? 0 : -1;
                await browser.tabs.create({
                    url: browser.runtime.getURL(`html/rewards.html?status=${status}`)
                });
            };
        }
    } catch (error) {
        console.error("获取奖励信息失败:", error);
    }
}
