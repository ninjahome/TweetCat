import browser, {Runtime} from "webextension-polyfill";
import {MsgType} from "../common/consts";
import {
    CategoryForId,
    loadCategories,
    queryKolByName,
    removeKolsCategory,
    updateKolsCategory
} from "../object/category";
import {kolById, kolsForCategory, loadAllKols, TweetKol} from "../object/tweet_kol";
import {
    cacheRawTweets,
    initTweetsCheck,
    loadCachedTweetsByUserId,
    loadLatestTweets, removeTweetsByKolID, updateBookmarked,
    WrapEntryObj
} from "../timeline/db_raw_tweet";
import {loadAllKolCursors, loadCursorById, writeKolsCursors, writeOneCursor} from "../object/kol_cursor";
import {timerKolInQueueImmediate} from "./bg_timer";
import {tweetFM} from "./tweet_fetch_manager";
import {penalize429, useTokenByUser} from "./api_bucket_state";
import {addBlockedAdsNumber} from "../object/system_setting";
import {checkLocalApp, openLocalApp} from "./local_app";
import {
    assignFollowingsToCategory,
    loadAllFollowings,
    replaceFollowingsPreservingCategories,
    FollowingUser
} from "../object/following";


export async function checkIfXIsOpen(): Promise<boolean> {
    const tabs = await browser.tabs.query({
        url: "*://x.com/*"
    });

    return tabs.length > 0;
}

export async function bgMsgDispatch(request: any, _sender: Runtime.MessageSender) {
    // console.log("-----------bgMsgDispatch-------------->>>_sender is: ", request)

    switch (request.action) {

        case MsgType.FollowingBulkUnfollow: {
            const payload = request?.payload ?? {};
            const rawUserIds = Array.isArray(payload?.userIds) ? payload.userIds : [];
            const throttleMsRaw = payload?.throttleMs;
            const throttleMs =
                typeof throttleMsRaw === "number" && throttleMsRaw >= 0 ? throttleMsRaw : 1100;

            const targetTab = await findActiveXTab();
            if (!targetTab?.id) {
                return {success: false, data: "Please open x.com before unfollowing."};
            }

            try {
                const response = await browser.tabs.sendMessage(targetTab.id, {
                    action: MsgType.FollowingBulkUnfollow,
                    payload: {
                        userIds: rawUserIds,
                        throttleMs,
                    },
                });

                if (!response) {
                    return {success: false, data: "No response from the Twitter tab."};
                }

                if (response?.error) {
                    const errorMessage = typeof response.error === "string" ? response.error : "Failed to unfollow selected accounts.";
                    return {success: false, data: errorMessage};
                }

                return {success: true, data: response};
            } catch (error) {
                const err = error as Error;
                console.warn("------>>> Following bulk unfollow failed", err);
                return {success: false, data: err?.message ?? "Failed to unfollow selected accounts."};
            }
        }

        case MsgType.OpenPlugin: {
            await openPlugin();
            return {success: true};
        }

        case MsgType.KolQueryByCategoryId: {
            const data = await kolsForCategory(request.data);
            return {success: true, data: Array.from(data.entries())};
        }

        case MsgType.CategoryQueryAll: {
            const catData = await loadCategories();
            // console.log("------------------------->>>catData is: ", catData)
            return {success: true, data: catData};
        }

        case MsgType.CategoryQueryById: {
            const catData = await CategoryForId(request.data);
            return {success: true, data: catData};
        }

        case MsgType.FollowingQueryAll: {
            const followings = await loadAllFollowings();
            return {success: true, data: followings};
        }

        case MsgType.FollowingAssignCategory: {
            const {userIds, categoryId} = request.data || {};
            await assignFollowingsToCategory(userIds ?? [], typeof categoryId === 'number' ? categoryId : null);
            return {success: true};
        }

        case MsgType.FollowingSync: {
            const tabs = await browser.tabs.query({
                url: ["*://x.com/*", "*://twitter.com/*"],
            });
            if (tabs.length === 0) {
                return {success: false, data: "Please open x.com before syncing."};
            }

            try {
                const response = await browser.tabs.sendMessage(tabs[0].id!, {
                    action: MsgType.FollowingSync,
                });

                if (!response?.success) {
                    return {success: false, data: response?.data ?? "Failed to fetch followings."};
                }

                const users = response.data as FollowingUser[] ?? [];
                await replaceFollowingsPreservingCategories(users);
                return {success: true, data: {count: users.length ?? 0}};
            } catch (error) {
                const err = error as Error;
                console.warn("------>>> Following sync failed", err);
                return {success: false, data: err.message};
            }
        }

        case MsgType.KolUpdate: {
            await updateKolsCategory(request.data as TweetKol);
            return {success: true};
        }

        case MsgType.KolRemove:
            await removeKolsCategory(request.data);
            return {success: true};

        case MsgType.KolQueryByName: {
            const kolCat = await queryKolByName(request.data)
            return {success: true, data: kolCat};
        }

        case MsgType.TweetCacheToDB: {
            const rd = request.data;
            return {success: true, data: await cacheRawTweets(rd.kolId, rd.data as WrapEntryObj[])};
        }

        case MsgType.TweetReadByKolId: {
            const reqData = request.data;
            const data = await loadCachedTweetsByUserId(reqData.kolId, reqData.limit)
            return {success: true, data: data};
        }

        case MsgType.TweetsBootStrap:
            return {success: true, data: await initTweetsCheck()};

        case MsgType.TweetReadByCategoryId: {
            const reqData = request.data;
            return {success: true, data: await loadLatestTweets(reqData.limit, reqData.category, reqData.timeStamp)};
        }

        case MsgType.TweetRemoveByKolID: {
            const kid = request.data as string;
            await removeTweetsByKolID(kid);
            await tweetFM.removeFromImmediateQueue(kid);
            return {success: true};
        }

        case MsgType.TweetBookmarkToggle: {
            await updateBookmarked(request.data.entryID as string, request.data.bookmarked as boolean)
            return {success: true};
        }

        case MsgType.KolQueryAll: {
            return {success: true, data: await loadAllKols()};
        }

        case MsgType.KolQueryByID: {
            return {success: true, data: await kolById(request.data as string)};
        }

        case MsgType.KolCursorLoadAll: {
            return {success: true, data: await loadAllKolCursors()};
        }

        case MsgType.KolCursorSaveAll: {
            await writeKolsCursors(request.data);
            return {success: true};
        }

        case MsgType.KolCursorSaveOne: {
            await writeOneCursor(request.data);
            return {success: true};
        }

        case MsgType.KolCursorQueryOne: {
            return {success: true, data: await loadCursorById(request.data as string)};
        }

        case MsgType.KolCursorForFirstOpen: {
            return {success: true, data: await tweetFM.getNextKolGroup(true)};
        }

        case MsgType.TimerKolInQueueAtOnce: {
            await timerKolInQueueImmediate(request.data as string)
            return {success: true};
        }

        case MsgType.TokenUsedByUser: {
            await useTokenByUser();
            return {success: true};
        }

        case MsgType.TokenFreeze: {
            await penalize429();
            return {success: true};
        }

        case MsgType.AdsBlockSuccess: {
            await addBlockedAdsNumber()
            return {success: true};
        }

        case MsgType.CheckIfLocalAppInstalled:{
            return {success:await checkLocalApp()}
        }

        case MsgType.StartLocalApp:{
            return {success:await openLocalApp()}
        }

        default:
            return {success: false, data: "unsupportable message type"};
    }
}

function isXUrl(url: string | undefined | null): boolean {
    if (!url) return false;
    try {
        const parsed = new URL(url);
        return parsed.hostname.endsWith("x.com") || parsed.hostname.endsWith("twitter.com");
    } catch (error) {
        return false;
    }
}

async function findActiveXTab(): Promise<browser.Tabs.Tab | null> {
    const [activeTab] = await browser.tabs.query({active: true, currentWindow: true});
    if (activeTab && isXUrl(activeTab.url)) {
        return activeTab;
    }

    const tabs = await browser.tabs.query({
        url: ["*://x.com/*", "*://twitter.com/*"],
    });

    if (tabs.length > 0) {
        return tabs[0];
    }

    return null;
}

async function openPlugin() {
    await browser.action.openPopup();
}

export async function sendMessageToX(action: string, data: any, onlyFirstTab: boolean = true, url = '*://x.com/*'): Promise<boolean> {
    const tabs = await browser.tabs.query({
        url: url
    });

    if (tabs.length === 0) {
        console.log(`------>>> x is not open!`);
        return false;
    }

    for (let i = 0; i < tabs.length; i++) {
        const tab = tabs[i];
        try {
            await browser.tabs.sendMessage(tab.id!, {
                action: action,
                data: data
            });

            if (onlyFirstTab) return true;

        } catch (err) {
            console.warn("------>>> 发送消息失败", err);
            return false;
        }
    }
    return true;
}
