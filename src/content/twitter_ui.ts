import { observeForElement, parseContentHtml, sendMsgToOffScreen, sendMsgToService } from "../common/utils";
import { choseColorByID, MsgType } from "../common/consts";
import { queryKolDetailByName, showPopupMenu } from "./twitter_observer";
import { TweetKol, updateKolIdToSw } from "../object/tweet_kol";
import { queryCategoriesFromBG, queryCategoryById } from "../object/category";
import { getUserIdByUsername } from "../x_api/twitter_api";
import { logTPR } from "../common/debug_flags";
import { calculateLevelBreakdown, LevelScoreBreakdown, UserProfile } from "../object/user_info";
import { t } from "../common/i18n";
import { ADS_FOLLOW_CLAIM_STATUS, ADS_FOLLOW_UI_MODE, AdsFollowClaimStatus, AdsFollowUiMode, showDialog, showToastMsg } from "./common";

import { loggedInUserScreenName } from "./tweet_user_info";

let observing = false;
let __lastProfileToolbar: HTMLElement | null = null;
let __lastProfileUsername: string | null = null;

type FollowingSnapshot = {
    isFollowing: boolean | null;
    capturedAt: number;
};

let __pendingFollowResolver: ((success: boolean) => void) | null = null;

export function notifyFollowResult(success: boolean) {
    if (__pendingFollowResolver) {
        __pendingFollowResolver(success);
        __pendingFollowResolver = null;
    }
}

function findNativeFollowButton(): HTMLElement | null {
    // 1. 限制在主列查找，排除侧边栏“推荐关注”的干扰
    const container = document.querySelector('div[data-testid="primaryColumn"]') || document.body;

    // 2. 查找以 "-follow" 结尾的 data-testid。
    // 这涵盖了 "Follow" 和 "Follow back" 两种情况，且比 aria-label (locale相关) 更稳定。
    // 排除 -unfollow 和 -pending，只找真正的关注按钮
    const btn = container.querySelector('[data-testid$="-follow"]:not([data-testid$="-unfollow"]):not([data-testid$="-pending"])') as HTMLElement;

    if (btn) {
        // 3. 确认为按钮角色
        const role = btn.getAttribute('role');
        const tagName = btn.tagName.toLowerCase();
        if (role === 'button' || tagName === 'button') {
            return btn;
        }
    }
    return null;
}

const __followingCache = new Map<string, FollowingSnapshot>();

function isProfileHomePath(username: string): boolean {
    try {
        const parts = new URL(window.location.href).pathname.split("/").filter(Boolean);
        return parts.length === 1 && parts[0].toLowerCase() === username.toLowerCase();
    } catch {
        return false;
    }
}

function parseIsFollowingFromUserByScreenName(raw: any): boolean | null {
    const u = raw?.data?.user?.result || raw?.data?.user_result_by_screen_name?.result;
    const v = u?.legacy?.following;
    return typeof v === "boolean" ? v : null;
}

function formatRewardUsdc(x: number): string {
    const v = Number(x);
    if (!Number.isFinite(v)) return "0";
    const rounded = Math.round(v * 1e6) / 1e6;
    return String(rounded);
}

export function updateFollowingSnapshotFromInject(screenName: string, rawProfile: any | boolean) {
    const key = String(screenName || "").toLowerCase();
    if (!key) return;

    let isFollowing: boolean | null = null;
    if (typeof rawProfile === "boolean") {
        isFollowing = rawProfile;
    } else if (rawProfile && typeof rawProfile.isFollowing === "boolean") {
        isFollowing = rawProfile.isFollowing;
    } else {
        isFollowing = parseIsFollowingFromUserByScreenName(rawProfile);
    }

    __followingCache.set(key, { isFollowing, capturedAt: Date.now() });

    if (__lastProfileToolbar && __lastProfileUsername && __lastProfileUsername.toLowerCase() === key) {
        _appendAdsFollowOfferBtn(__lastProfileToolbar, __lastProfileUsername).then();
    }
}

export async function appendFilterOnKolProfilePage(kolName: string) {
    if (observing) {
        return;
    }

    observing = true;
    observeForElement(document.body, 800, () => {
        return document.querySelector(".css-175oi2r.r-obd0qt.r-18u37iz.r-1w6e6rj.r-1h0z5md.r-dnmrzs") as HTMLElement
    }, async (profileToolBarDiv) => {
        __lastProfileToolbar = profileToolBarDiv;
        __lastProfileUsername = kolName;
        const oldFilterBtn = profileToolBarDiv.querySelectorAll(".filter-btn-on-profile");
        oldFilterBtn.forEach(item => item.remove());
        await _appendFilterBtn(profileToolBarDiv, kolName);
        await _appendAdsFollowOfferBtn(profileToolBarDiv, kolName);
        observing = false;
    }, false);
}

const kolScoreCache = new Map<string, LevelScoreBreakdown>();

export async function appendScoreInfoToProfilePage(usrProfile: UserProfile, userName: string) {

    console.log("[injection fetched data]------>>>screen name：", userName, "\n raw data:", usrProfile);

    try {
        const scoreData = calculateLevelBreakdown(usrProfile);
        // console.log("------>>> score data:", scoreData);
        kolScoreCache.set(userName, scoreData);

        const userInfoArea = document.querySelector(`div[data-testid="UserName"]`)

        let scoreDiv = document.getElementById("user-profile-score") as HTMLElement;
        if (!scoreDiv) {
            const tpl = await parseContentHtml("html/content.html");
            scoreDiv = tpl.content.getElementById("user-profile-score")?.cloneNode(true) as HTMLElement;
            userInfoArea?.appendChild(scoreDiv);
        }

        let transferDiv = document.getElementById("user-transfer-usdc") as HTMLElement;
        if (!transferDiv) {
            const tpl = await parseContentHtml("html/content.html");
            transferDiv = tpl.content.getElementById("user-transfer-usdc")?.cloneNode(true) as HTMLElement;

            const btn = transferDiv.querySelector(".transfer-btn") as HTMLButtonElement;
            btn.onclick = async () => {
                if (!usrProfile.userId) {
                    showDialog(t('tips_title'), "无效的用户id")
                    return
                }
                await sendMsgToService(usrProfile, MsgType.TransferUSDCByTwitterId)
            }

            (transferDiv.querySelector(".transfer-usdc-btn-title") as HTMLSpanElement).innerText = t("transfer_usdc_btn_title")
            userInfoArea?.appendChild(transferDiv);
        }

        (scoreDiv.querySelector(".total-score-value") as HTMLElement).innerText = "" + scoreData.total;
        (scoreDiv.querySelector(".total-score-title") as HTMLElement).innerText = t("total_score_title");

        const scoreDetailDiv = document.getElementById("user-profile-score-details") as HTMLElement;
        if (!scoreDetailDiv) return;

        scoreDiv.addEventListener("mouseenter", () => {
            scoreDetailDiv.classList.add("show");
            requestAnimationFrame(() => {
                const rect = scoreDiv.getBoundingClientRect();
                const detailHeight = scoreDetailDiv.offsetHeight;
                scoreDetailDiv.style.top = rect.top + window.scrollY - detailHeight - 8 + "px";
                scoreDetailDiv.style.left = rect.left + window.scrollX + "px";
            });
        });

        scoreDiv.addEventListener("mouseleave", () => {
            scoreDetailDiv.classList.remove("show");
        });


        (scoreDetailDiv.querySelector(".scale-score-value") as HTMLElement).innerText = scoreData.scale.toFixed(2);
        (scoreDetailDiv.querySelector(".activity-score-value") as HTMLElement).innerText = scoreData.activity.toFixed(2);
        (scoreDetailDiv.querySelector(".trust-score-value") as HTMLElement).innerText = scoreData.trust.toFixed(2);
        (scoreDetailDiv.querySelector(".brand-score-value") as HTMLElement).innerText = scoreData.brand.toFixed(2);
        (scoreDetailDiv.querySelector(".growth-score-value") as HTMLElement).innerText = scoreData.growth.toFixed(2);

    } catch (e) {
        console.warn("failed to append score data to profile page.", e, userName);
    }
}

async function _appendFilterBtn(toolBar: HTMLElement, kolName: string) {
    const contentTemplate = await parseContentHtml('html/content.html');
    const menuBtn = contentTemplate.content.getElementById("filter-btn-on-profile") as HTMLElement;

    const clone = menuBtn.cloneNode(true) as HTMLElement;
    clone.setAttribute('id', "");
    await setCategoryStatusOnProfileHome(kolName, clone)
    toolBar.insertBefore(clone, toolBar.firstChild);
    clone.onclick = async (e) => {
        const categories = await queryCategoriesFromBG();
        if (categories.length === 0) {
            alert("no valid categories");//TODO::
            return;
        }
        let kol = await queryKolDetailByName(kolName);
        if (!kol) {
            const userNameDiv = document.querySelector(
                'div.css-175oi2r.r-18u37iz.r-1w6e6rj.r-6gpygo.r-14gqq1x[data-testid="UserName"]'
            );
            const displayNameDiv = userNameDiv?.querySelector(".css-1jxf684.r-bcqeeo.r-1ttztb7.r-qvutc0.r-poiln3")
            let displayName = displayNameDiv?.textContent?.trim() ?? "TweetCat";
            kol = new TweetKol(kolName, displayName);
        }

        _kolCompletion(kol).then()

        showPopupMenu(e, clone, categories, kol, setCategoryStatusOnProfileHome);
    }
}

function checkIsFollowingFromDom(username: string): boolean {
    // 1. Check for specific unfollow button by testid suffix
    // Twitter usually puts UserCell or Profile timeline elements with testid like "12345-unfollow"
    const unfollowBtns = document.querySelectorAll('div[role="button"][data-testid$="-unfollow"]');
    if (unfollowBtns.length > 0) return true;

    // 2. Check for text content "Following" or "关注中" in prominent buttons
    // This is less reliable but a good backup.
    // We restrict search to the primary column or user profile header area if possible.
    const primaryCol = document.querySelector('div[data-testid="primaryColumn"]');
    if (!primaryCol) return false;

    // Look for the main action button on profile
    const userActions = primaryCol.querySelector('div[data-testid="userActions"]');
    if (userActions) {
        const text = userActions.textContent?.toLowerCase() || "";
        if (text.includes("following") || text.includes("关注中") || text.includes("正在关注")) {
            return true;
        }
    }

    return false;
}

async function _appendAdsFollowOfferBtn(toolBar: HTMLElement, kolName: string) {
    toolBar.querySelectorAll(".follow-claim-on-profile").forEach((item) => item.remove());
    toolBar.querySelectorAll(".follow-claim-btn-on-profile").forEach((item) => item.remove());

    if (loggedInUserScreenName && kolName.toLowerCase() === loggedInUserScreenName.toLowerCase()) {
        return;
    }

    // Check if already following
    if (checkIsFollowingFromDom(kolName)) {
        return;
    }
    const earlySnap = __followingCache.get(kolName.toLowerCase());
    if (earlySnap && earlySnap.isFollowing === true) {
        return;
    }

    if (!isProfileHomePath(kolName)) return;

    const q = await sendMsgToService({ profileUrl: window.location.href }, MsgType.AdsFollowOfferQuery);
    if (!q?.success) return;

    // backward/forward compatible: old handler returned offer directly; new returns {offer, claim_state}
    const payload = q?.data;
    const offer = (payload && typeof payload === "object" && "ad_id" in payload)
        ? payload
        : payload?.offer;
    const claimState = payload?.claim_state ?? null;

    if (!offer?.ad_id) return;

    const contentTemplate = await parseContentHtml("html/content.html");
    const template = contentTemplate.content.getElementById("follow-claim-on-profile") as HTMLElement | null;
    if (!template) return;

    const clone = template.cloneNode(true) as HTMLElement;
    clone.setAttribute("id", "");

    const btn = clone.querySelector(".follow-claim-btn-on-profile") as HTMLButtonElement | null;
    const title = clone.querySelector(".follow-claim-btn-title") as HTMLElement | null;

    const snap = __followingCache.get(kolName.toLowerCase());
    let isFollowing = snap?.isFollowing ?? null;
    const claimStatus = claimState?.status as AdsFollowClaimStatus | undefined;

    const setUi = (mode: AdsFollowUiMode) => {
        if (!btn) return;
        btn.disabled = (mode !== ADS_FOLLOW_UI_MODE.Eligible);
        btn.classList.toggle("tc-processing", mode === ADS_FOLLOW_UI_MODE.Processing);
        const rewardText = formatRewardUsdc(Number(offer.reward_usdc || 0));

        let text = `关注即领 ${rewardText} USDC`;
        if (mode === ADS_FOLLOW_UI_MODE.Loading) text = "加载中...";
        if (mode === ADS_FOLLOW_UI_MODE.AlreadyFollowing) text = "已关注";
        if (mode === ADS_FOLLOW_UI_MODE.Processing) text = "处理中...";
        if (mode === ADS_FOLLOW_UI_MODE.Claimed) text = "已领取，待验证";
        if (title) title.textContent = text;
    };

    if (btn) {
        // DOM fallback check
        if (!isFollowing) {
            const domFollowing = checkIsFollowingFromDom(kolName);
            if (domFollowing) {
                console.log("[TwitterUI] Fallback: detected following status from DOM");
                isFollowing = true;
                // Update cache to avoid re-checking DOM constantly
                const key = kolName.toLowerCase();
                const snap = __followingCache.get(key);
                if (snap) {
                    snap.isFollowing = true;
                    __followingCache.set(key, snap);
                }
            }
        }

        if (claimStatus === ADS_FOLLOW_CLAIM_STATUS.ClaimedPendingProof) {
            setUi(ADS_FOLLOW_UI_MODE.Claimed);
        } else if (claimStatus === ADS_FOLLOW_CLAIM_STATUS.Processing) {
            setUi(ADS_FOLLOW_UI_MODE.Processing);
        } else if (isFollowing === true) {
            setUi(ADS_FOLLOW_UI_MODE.AlreadyFollowing);
        } else if (isFollowing === false) {
            setUi(ADS_FOLLOW_UI_MODE.Eligible);
            btn.onclick = async (e) => {
                e.preventDefault();
                e.stopPropagation();

                setUi(ADS_FOLLOW_UI_MODE.Processing);
                if (title) title.textContent = "正在验证钱包状态...";

                // 1. 优先检查钱包登录状态 (走 Offscreen 以获得准确 CDP 状态)
                const walletInfo = await sendMsgToOffScreen({}, MsgType.WalletInfoQuery);
                if (!walletInfo?.success || !walletInfo?.data?.address) {
                    setUi(ADS_FOLLOW_UI_MODE.Eligible);
                    showDialog(t('tips_title'), "请先在插件中登录钱包账号，再执行关注领奖。");
                    return;
                }

                console.log(`[TwitterUI] Wallet Identity: addr=${walletInfo.data.address}, xId=${walletInfo.data.xId}, userId=${walletInfo.data.userId}`);

                const nativeBtn = findNativeFollowButton();
                console.log("[TwitterUI] Native Follow button search result:", nativeBtn);
                if (!nativeBtn) {
                    setUi(ADS_FOLLOW_UI_MODE.Eligible);
                    showDialog(t('tips_title'), "未找到关注按钮，请确认是否已关注或页面加载完成。")
                    return;
                }

                if (title) title.textContent = "正在同步关注状态...";

                // Create a promise to wait for the interceptor to signal success
                let timerId: any;
                const followConfirmed = new Promise<boolean>((resolve) => {
                    __pendingFollowResolver = (success: boolean) => {
                        console.log("[TwitterUI] Received follow confirmation signal:", success);
                        if (timerId) clearTimeout(timerId);
                        resolve(success);
                    };
                    // Timeout safety: 15 seconds
                    timerId = setTimeout(() => {
                        console.warn("[TwitterUI] Follow confirmation TIMEOUT after 15s");
                        resolve(false);
                    }, 15000);
                });

                console.log("[TwitterUI] Triggering native follow button click...");
                // Trigger native follow
                nativeBtn.click();

                const isSuccess = await followConfirmed;
                console.log("[TwitterUI] Final follow result for orchestration:", isSuccess);

                if (!isSuccess) {
                    setUi(ADS_FOLLOW_UI_MODE.Eligible);
                    showDialog(t('tips_title'), "关注确认超时或失败，请重试。")
                    return;
                }

                if (title) title.textContent = "关注成功，正在进行二次验证...";

                console.log(`[TwitterUI] >>> Step 3: Sending AdsFollowVerifyAndClaim to SW`, {
                    ad_id: offer.ad_id,
                    screen_name: kolName
                });

                const resp = await sendMsgToService(
                    {
                        ad_id: offer.ad_id,
                        screen_name: kolName,
                        profileUrl: window.location.href,
                        userId: walletInfo.data?.userId,
                        xId: walletInfo.data?.xId,
                        walletAddress: walletInfo.data?.address
                    },
                    MsgType.AdsFollowVerifyAndClaim,
                );

                console.log(`[TwitterUI] <<< Step 4: Received response from SW`, resp);

                if (!resp?.success) {
                    setUi(ADS_FOLLOW_UI_MODE.Eligible);
                    const errorMsg = typeof resp?.data === 'object' ? JSON.stringify(resp.data) : String(resp?.data || "未知错误");
                    showDialog(t('tips_title'), `验证失败: ${errorMsg}`);
                    return;
                }

                console.log(`[TwitterUI] SUCCESS: Claim flow finished.`, resp.data);

                if (resp.data?.already_claimed) {
                    console.log("[TwitterUI] Detected repeated claim, showing dialog.");
                    showDialog(t('tips_title'), "您已成功重新关注！检测到该奖励之前已成功领取，无需重复申领。");
                } else {
                    showDialog(t('tips_title'), "申领成功！奖励后续将发放至您的钱包。");
                }

                setUi(ADS_FOLLOW_UI_MODE.Claimed);
                /*
                console.log("---------------- [DEBUG: AdsFollowClaim Material] ----------------");
                ...
                */
            };
        } else {
            // follow status unknown yet (waiting inject)
            setUi(ADS_FOLLOW_UI_MODE.Loading);
        }
    }

    const placementTracking = toolBar.querySelector('div[data-testid="placementTracking"]');
    if (placementTracking && placementTracking.parentElement === toolBar) {
        toolBar.insertBefore(clone, placementTracking);
        return;
    }

    toolBar.appendChild(clone);
}

async function _kolCompletion(kol: TweetKol) {
    let needUpDateKolData = false;
    if (!kol.avatarUrl) {
        kol.avatarUrl = document.querySelector('div[data-testid="primaryColumn"] div[data-testid^="UserAvatar-Container-"] img')?.getAttribute('src') ?? "";
        logTPR("------>>> avatar url found:[", kol.avatarUrl, "]for kol:", kol.kolName);
        needUpDateKolData = !!kol.avatarUrl
    }

    if (!kol.kolUserId) {
        kol.kolUserId = await getUserIdByUsername(kol.kolName) ?? "";
        needUpDateKolData = !!kol.kolUserId
        logTPR("------>>> need to load kol user id by tweet api:", kol.kolName, "found user id:", kol.kolUserId);
    }

    if (!needUpDateKolData) {
        return;
    }

    await updateKolIdToSw(kol);
    logTPR("------>>> update kol data success", kol)
}

async function setCategoryStatusOnProfileHome(kolName: string, clone: HTMLElement) {
    let kol = await queryKolDetailByName(kolName);
    const buttonDiv = clone.querySelector('.noCategory') as HTMLElement;
    const nameDiv = clone.querySelector(".hasCategory") as HTMLElement;

    // 没有 kol 或没有 catID → 未分类
    if (!kol || !kol.catID) {
        buttonDiv.style.display = 'flex';   // profile 页默认布局
        nameDiv.style.display = 'none';
        return;
    }

    const cat = await queryCategoryById(kol.catID!);
    if (!cat) {
        // 分类被删除或无效 → 也当作未分类
        buttonDiv.style.display = 'flex';
        nameDiv.style.display = 'none';
        console.log("category not found or invalid for kol", kol);
        return;
    }

    // 正常分类展示
    buttonDiv.style.display = 'none';
    nameDiv.style.display = 'block';
    (nameDiv.querySelector(".dot") as HTMLElement).style.backgroundColor = choseColorByID(kol.catID!);
    nameDiv.querySelector(".category-name")!.textContent = cat.catName;
}
