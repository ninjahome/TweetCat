import browser from "webextension-polyfill";
import { observeForElement, parseContentHtml, sendMsgToOffScreen, sendMsgToOffScreenWithTimeout, sendMsgToService } from "../common/utils";
import { choseColorByID, MsgType } from "../common/consts";
import { queryKolDetailByName, showPopupMenu } from "./twitter_observer";
import { TweetKol, updateKolIdToSw } from "../object/tweet_kol";
import { queryCategoriesFromBG, queryCategoryById } from "../object/category";
import { getUserIdByUsername } from "../x_api/twitter_api";
import { logTPR } from "../common/debug_flags";
import { calculateLevelBreakdown, LevelScoreBreakdown, UserProfile } from "../object/user_info";
import { t } from "../common/i18n";
import { ADS_FOLLOW_CLAIM_STATUS, ADS_FOLLOW_UI_MODE, AdsFollowClaimStatus, AdsFollowUiMode, hideGlobalLoading, showDialog, showGlobalLoading, showToastMsg } from "./common";

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

const PROFILE_SUB_PAGES = new Set([
    "", "affiliates", "with_replies", "highlights", "media", "superfollows"
]);

function isProfileHomePath(username: string): boolean {
    try {
        const parts = new URL(window.location.href).pathname.split("/").filter(Boolean);
        if (parts.length < 1 || parts.length > 2) return false;
        if (parts[0].toLowerCase() !== username.toLowerCase()) return false;
        const suffix = parts[1] ?? "";
        return PROFILE_SUB_PAGES.has(suffix);
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
        // If unfollowed, we definitely want to ensure the button is refreshed/shown
        if (isFollowing === false) {
            const existing = __lastProfileToolbar.querySelector(".follow-claim-on-profile");
            const isProcessing = existing?.querySelector(".tc-processing");
            if (!isProcessing) {
                existing?.remove();
                _appendAdsFollowOfferBtn(__lastProfileToolbar, __lastProfileUsername).then();
            }
        } else if (isFollowing === true) {
            // If following, ensure it is removed (or updated to "Already Following")
            _appendAdsFollowOfferBtn(__lastProfileToolbar, __lastProfileUsername).then();
        }
    }
}

export async function appendFilterOnKolProfilePage(kolName: string) {
    if (observing) {
        return;
    }

    observing = true;

    // We try multiple selectors to find the action bar/toolbar on the profile page
    const selectors = [
        ".css-175oi2r.r-obd0qt.r-18u37iz.r-1w6e6rj.r-1h0z5md.r-dnmrzs", // Brittle but common
        'div[data-testid="primaryColumn"] [data-testid="userActions"]', // Good candidate
        'div[data-testid="UserProfileHeader_Items"]', // Header items area
    ];

    observeForElement(document.body, 800, () => {
        for (const selector of selectors) {
            const el = document.querySelector(selector) as HTMLElement;
            if (el) return el;
        }
        // Fallback: search for the follow button and find its parent toolbar container
        const followBtn = findNativeFollowButton();
        if (followBtn) {
            return followBtn.closest('.css-175oi2r.r-18u37iz.r-1w6e6rj') as HTMLElement;
        }
        return null;
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

        const isSelf = loggedInUserScreenName && userName.toLowerCase() === loggedInUserScreenName.toLowerCase();
        let transferDiv = document.getElementById("user-transfer-usdc") as HTMLElement;

        if (isSelf) {
            transferDiv?.remove();
        } else if (!transferDiv) {
            const tpl = await parseContentHtml("html/content.html");
            transferDiv = tpl.content.getElementById("user-transfer-usdc")?.cloneNode(true) as HTMLElement;

            const btn = transferDiv.querySelector(".transfer-btn") as HTMLButtonElement;
            btn.onclick = async () => {
                if (!usrProfile.userId) {
                    showDialog(t('tips_title'), t('invalid_user_id'))
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
    if (loggedInUserScreenName && kolName.toLowerCase() === loggedInUserScreenName.toLowerCase()) {
        return;
    }

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
    // 1. Target the profile header action area specifically
    const header = document.querySelector('div[data-testid="UserProfileHeader_Items"]') ||
        document.querySelector('div[data-testid="primaryColumn"] div[data-testid="userActions"]')?.parentElement;

    if (header) {
        const unfollowBtn = header.querySelector('div[role="button"][data-testid$="-unfollow"]');
        if (unfollowBtn) return true;

        const text = header.textContent?.toLowerCase() || "";
        if (text.includes("following") || text.includes("关注中") || text.includes("正在关注")) {
            return true;
        }
    }

    // 2. Secondary check restricted to primary column (Top area only)
    const primaryCol = document.querySelector('div[data-testid="primaryColumn"]');
    if (primaryCol) {
        // Limit search to the top of the profile (where the header is)
        // This avoids picking up tweets in the timeline
        const userHeader = primaryCol.querySelector('div[data-testid="UserName"]')?.closest('.css-175oi2r');
        if (userHeader) {
            const unfollowBtn = userHeader.querySelector('div[role="button"][data-testid$="-unfollow"]');
            if (unfollowBtn) return true;
        }
    }

    return false;
}

async function _appendAdsFollowOfferBtn(toolBar: HTMLElement, kolName: string, retryCount = 0) {
    const existing = toolBar.querySelector(".follow-claim-on-profile");

    // Requirement: If already following (detected via DOM or internal cache), the button should not exist.
    // This handles the case where a user manually clicks the native "Follow" button.
    const earlySnap = __followingCache.get(kolName.toLowerCase());

    // We trust the explicitly "false" cache more than the DOM, 
    // because the DOM might still show "Following" immediately after clicking unfollow.
    const isNowFollowing = (earlySnap && earlySnap.isFollowing === true) ||
        ((!earlySnap || earlySnap.isFollowing === null) && checkIsFollowingFromDom(kolName));

    if (isNowFollowing) {
        existing?.remove();
        return;
    }

    if (existing) {
        return;
    }

    if (loggedInUserScreenName && kolName.toLowerCase() === loggedInUserScreenName.toLowerCase()) {
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

    if (!offer?.ad_id) {
        // If no offer found on initial load, retry a few times (in case ads feed is still polling)
        if (retryCount < 3) {
            console.log(`[TwitterUI] No follow offer found for ${kolName}, retry ${retryCount + 1}/3 in 2s...`);
            setTimeout(() => _appendAdsFollowOfferBtn(toolBar, kolName, retryCount + 1), 2000);
        }
        return;
    }

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

        let text = t('follow_claim_btn_text', [rewardText]);
        if (mode === ADS_FOLLOW_UI_MODE.Loading) text = t('claim_loading');
        if (mode === ADS_FOLLOW_UI_MODE.AlreadyFollowing) text = t('claim_already_following');
        if (mode === ADS_FOLLOW_UI_MODE.Processing) text = t('claim_processing');
        if (mode === ADS_FOLLOW_UI_MODE.Claimed) text = t('claim_pending_verification');
        if (mode === ADS_FOLLOW_UI_MODE.AlreadyClaimed) text = t('claim_already_claimed_status');
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

        if (claimStatus === ADS_FOLLOW_CLAIM_STATUS.Claimed) {
            setUi(ADS_FOLLOW_UI_MODE.AlreadyClaimed);
        } else if (claimStatus === ADS_FOLLOW_CLAIM_STATUS.ClaimedPendingProof) {
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
                if (title) title.textContent = t('claim_verifying_wallet');

                // 1. 检查钱包登录状态 (走 Offscreen 以获得准确 CDP 状态)
                //    首次失败时自动重试一次，应对 Offscreen 被回收或 CDP 会话未恢复的偶发情况
                let walletInfo = await sendMsgToOffScreenWithTimeout({}, MsgType.WalletInfoQuery, 8000);
                if (!walletInfo?.success || !walletInfo?.data?.address) {
                    console.warn(`[TwitterUI] WalletInfoQuery attempt 1 failed. success=${walletInfo?.success}, data=`, walletInfo?.data, `error=`, walletInfo?.error, ` — retrying in 2s...`);
                    await new Promise(r => setTimeout(r, 2000));
                    walletInfo = await sendMsgToOffScreenWithTimeout({}, MsgType.WalletInfoQuery, 8000);
                }
                if (!walletInfo?.success || !walletInfo?.data?.address) {
                    console.warn(`[TwitterUI] WalletInfoQuery attempt 2 also failed. success=${walletInfo?.success}, data=`, walletInfo?.data);
                    setUi(ADS_FOLLOW_UI_MODE.Eligible);
                    const errMsg = walletInfo?.data === "TIMEOUT" ? t('claim_wallet_timeout') : t('claim_wallet_not_logged_in');
                    showDialog(t('tips_title'), errMsg);
                    return;
                }

                console.log(`[TwitterUI] Wallet Identity: addr=${walletInfo.data.address}, xId=${walletInfo.data.xId}, userId=${walletInfo.data.userId}`);

                // 2. 蓝V前置检查 (与广告广场 startTask 保持一致)
                if (title) title.textContent = t('claim_checking_verification');
                const blueVResp = await sendMsgToService(
                    { xId: walletInfo.data?.xId },
                    MsgType.AdsBlueVPreCheck,
                );
                console.log(`[TwitterUI] BlueV pre-check result:`, blueVResp);

                if (blueVResp?.success && blueVResp.data && !blueVResp.data.pass) {
                    setUi(ADS_FOLLOW_UI_MODE.Eligible);
                    const reason = blueVResp.data.reason;
                    const checkXId = blueVResp.data.xId || walletInfo.data?.xId;

                    if (reason === "NOT_BLUE_V") {
                        // 已验证但非蓝V → 提示重新验证
                        showDialog(
                            t('tips_title'),
                            t('blue_v_required') || "该任务要求推特蓝V认证。请先完成认证后再试。",
                            () => {
                                window.open(`https://x.com/i/user/${checkXId}?tc_verify=1`, "_blank");
                            },
                            t('reverify_btn') || "Re-verify"
                        );
                    } else {
                        // NO_RECORD 或 EXPIRED → 提示跳转 Profile 更新
                        const msg = reason === "NO_RECORD"
                            ? (t('verification_required_msg') || "请先访问您的推特个人主页以更新蓝V认证状态。")
                            : (t('status_expired_msg') || "您的蓝V认证状态已过期，请访问个人主页刷新。");
                        showDialog(
                            t('tips_title'),
                            msg,
                            () => {
                                window.open(`https://x.com/i/user/${checkXId}?tc_verify=1`, "_blank");
                            },
                            t('confirm') || "Confirm"
                        );
                    }
                    return;
                }

                const nativeBtn = findNativeFollowButton();
                console.log("[TwitterUI] Native Follow button search result:", nativeBtn);
                if (!nativeBtn) {
                    setUi(ADS_FOLLOW_UI_MODE.Eligible);
                    showDialog(t('tips_title'), t('claim_follow_btn_not_found'))
                    return;
                }

                if (title) title.textContent = t('claim_syncing_follow');

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
                    showDialog(t('tips_title'), t('claim_follow_timeout'))
                    return;
                }

                if (title) title.textContent = t('claim_follow_success_verifying');

                // The profile toolbar can re-render while the final verification is in flight.
                // Keep a stable global loading state so users don't see a blank gap before the result dialog.
                showGlobalLoading(t('claim_verifying_reward'), t('claim_reward_checking'));

                try {
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
                    hideGlobalLoading();

                    if (!resp?.success) {
                        const errorMsg = typeof resp?.data === 'object' ? JSON.stringify(resp.data) : String(resp?.data || t('rewards_unknown_error'));

                        // Timeout: the server likely processed the claim, show a gentler message
                        if (errorMsg.includes("timed out") || errorMsg.includes("超时") || errorMsg.includes("TIMEOUT")) {
                            setUi(ADS_FOLLOW_UI_MODE.Claimed);
                            const openPlaza = () => {
                                const url = browser.runtime.getURL('html/ad_plaza.html?tab=my-tasks');
                                sendMsgToService(url, MsgType.OpenOrFocusUrl);
                            };
                            showDialog(t('tips_title'), t('claim_timeout_may_succeed'), openPlaza, t('claim_view_now'));
                            return;
                        }

                        setUi(ADS_FOLLOW_UI_MODE.Eligible);
                        if (errorMsg.includes("BLUE_V_REQUIRED")) {
                            showDialog(
                                t('tips_title'),
                                t('verification_required_msg'),
                                () => {
                                    window.open(`https://x.com/i/user/${walletInfo.data?.xId}?tc_verify=1`, "_blank");
                                },
                                t('confirm')
                            );
                        } else {
                            let translatedErr = errorMsg;
                            if (errorMsg.includes("NOT_FOUND") || errorMsg.includes("Ad not found")) {
                                translatedErr = t("ad_not_found_msg");
                            } else if (errorMsg.includes("QUOTA_FULL")) {
                                translatedErr = t("ad_quota_full_msg");
                            } else if (errorMsg.includes("AD_EXPIRED")) {
                                translatedErr = t("ad_has_expired");
                            } else if (errorMsg.includes("Already claimed")) {
                                translatedErr = t("already_claimed_msg");
                            } else if (errorMsg.includes("EVIDENCE_REQUIRED")) {
                                translatedErr = t("ad_evidence_required_msg");
                            } else if (errorMsg.includes("SIGNATURE_REQUIRED") || errorMsg.includes("SIGNATURE_MISMATCH") || errorMsg.includes("INVALID_CLAIM_SIGNATURE") || errorMsg.includes("EVIDENCE_TAMPERED")) {
                                translatedErr = t("claim_signature_error_msg");
                            } else if (errorMsg.includes("SELF_CLAIM_FORBIDDEN")) {
                                translatedErr = t("self_claim_forbidden_msg");
                            }

                            if (translatedErr !== errorMsg) {
                                showDialog(t('tips_title'), translatedErr);
                            } else {
                                showDialog(t('tips_title'), `${t('verification_failed')}: ${errorMsg}`);
                            }
                        }
                        return;
                    }

                    console.log(`[TwitterUI] SUCCESS: Claim flow finished.`, resp.data);

                    const openPlaza = () => {
                        const url = browser.runtime.getURL('html/ad_plaza.html?tab=my-tasks');
                        sendMsgToService(url, MsgType.OpenOrFocusUrl);
                    };

                    if (resp.data?.already_claimed) {
                        console.log("[TwitterUI] Detected repeated claim, showing dialog.");
                        showDialog(t('tips_title'), t('claim_already_claimed_refollow'), openPlaza, t('claim_view_now'));
                    } else {
                        showDialog(t('tips_title'), t('claim_success_msg'), openPlaza, t('claim_view_now'));
                    }
                } catch (err) {
                    hideGlobalLoading();
                    const errorMsg = err instanceof Error ? err.message : String(err || t('rewards_unknown_error'));

                    // Timeout: the server likely processed the claim, show a gentler message
                    if (errorMsg.includes("timed out") || errorMsg.includes("超时") || errorMsg.includes("TIMEOUT")) {
                        setUi(ADS_FOLLOW_UI_MODE.Claimed);
                        const openPlaza = () => {
                            const url = browser.runtime.getURL('html/ad_plaza.html?tab=my-tasks');
                            sendMsgToService(url, MsgType.OpenOrFocusUrl);
                        };
                        showDialog(t('tips_title'), t('claim_timeout_may_succeed'), openPlaza, t('claim_view_now'));
                        return;
                    }

                    setUi(ADS_FOLLOW_UI_MODE.Eligible);
                    let translatedErr = errorMsg;
                    if (errorMsg.includes("NOT_FOUND") || errorMsg.includes("Ad not found")) {
                        translatedErr = t("ad_not_found_msg");
                    } else if (errorMsg.includes("QUOTA_FULL")) {
                        translatedErr = t("ad_quota_full_msg");
                    } else if (errorMsg.includes("AD_EXPIRED")) {
                        translatedErr = t("ad_has_expired");
                    } else if (errorMsg.includes("Already claimed")) {
                        translatedErr = t("already_claimed_msg");
                    }

                    if (translatedErr !== errorMsg) {
                        showDialog(t('tips_title'), translatedErr);
                    } else {
                        showDialog(t('tips_title'), `${t('verification_failed')}: ${errorMsg}`);
                    }
                    return;
                }

                // Requirement: After success, no longer show "Claimed" status on page if they are now following
                clone.remove();
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
