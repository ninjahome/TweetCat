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
    FollowingUser, removeLocalFollowings
} from "../object/following";
import {__tableFollowings, databaseUpdateOrAddItem} from "../common/database";


export async function checkIfXIsOpen(): Promise<boolean> {
    const tabs = await browser.tabs.query({
        url: "*://x.com/*"
    });

    return tabs.length > 0;
}

export async function bgMsgDispatch(request: any, _sender: Runtime.MessageSender) {
    switch (request.action) {

        case MsgType.FollowingBulkUnfollow: {
                return  await sendMessageToX( MsgType.FollowingBulkUnfollow,  request.data);
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

        case MsgType.FollowingRemoveLocal: {
            const { userIds } = request.data || {};
            return await removeLocalFollowings(userIds);
        }

        case MsgType.FollowingAssignCategory: {
            const {userIds, categoryId} = request.data || {};
            await assignFollowingsToCategory(userIds ?? [], typeof categoryId === 'number' ? categoryId : null);
            return {success: true};
        }

        case MsgType.FollowingFetchOne: {
            return await sendMessageToX( MsgType.FollowingFetchOne,  request.data);;
        }

        case MsgType.FollowingSync: {
            return await sendMessageToX( MsgType.FollowingSync,  request.data);
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

export async function sendMessageToX(action: string, data: any, onlyFirstTab: boolean = true, url = '*://x.com/*'): Promise<any> {
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
            const resp = await browser.tabs.sendMessage(tab.id!, {
                action: action,
                data: data
            });

            if (onlyFirstTab) return resp;

        } catch (err) {
            console.warn("------>>> 发送消息失败", err);
            return null;
        }
    }

    return true;
}
