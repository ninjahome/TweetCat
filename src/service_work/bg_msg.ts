import browser, {Runtime} from "webextension-polyfill";
import {MsgType, noXTabError} from "../common/consts";
import {
    CategoryForId,
    loadCategories, loadCategorySnapshot,
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
    loadAllFollowings
} from "../object/following";
import {
    transEthParam, transUsdcParam
} from "../wallet/wallet_api";
import {openOrUpdateTab} from "../common/utils";
import {loadIpfsLocalCustomGateWay} from "../wallet/ipfs_settings";
import {tipActionForTweet, walletSignedIn} from "./bg_x402";
import {msgExportPriKye, msgSignMsg, msgTransferEth, msgTransferUsdc, msgUnlockWallet} from "./wallet_controller";
import {x402TipPayload} from "../common/x402_obj";

export async function checkIfXIsOpen(): Promise<boolean> {
    const tabs = await browser.tabs.query({
        url: "*://x.com/*"
    });

    return tabs.length > 0;
}

export async function bgMsgDispatch(request: any, _sender: Runtime.MessageSender) {
    switch (request.action) {

        case MsgType.FollowingBulkUnfollow: {
            return await sendMessageToX(MsgType.FollowingBulkUnfollow, request.data);
        }

        case MsgType.OpenCategoryManagement: {
            await browser.tabs.create({
                url: browser.runtime.getURL("html/following_mgm.html"),
            });
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

        case MsgType.FollowingAssignCategory: {
            const {userIds, categoryId} = request.data || {};
            await assignFollowingsToCategory(userIds ?? [], typeof categoryId === 'number' ? categoryId : null);
            return {success: true};
        }

        case MsgType.FollowingFetchOne: {
            return await sendMessageToX(MsgType.FollowingFetchOne, request.data);
        }

        case MsgType.FollowingSync: {
            return await sendMessageToX(MsgType.FollowingSync, request.data);
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

        case MsgType.CheckIfLocalAppInstalled: {
            return {success: await checkLocalApp()}
        }

        case MsgType.StartLocalApp: {
            return {success: await openLocalApp()}
        }

        case MsgType.OpenOrFocusUrl: {
            await openOrUpdateTab(request.data as string)
            return {success: true};
        }

        case MsgType.SW_ACTION_GET_SNAPSHOT: {
            return {success: true, data: await loadCategorySnapshot()};
        }
        case MsgType.IPFS_GET_GATEWAY_BASE: {
            return {success: true, data: await loadIpfsLocalCustomGateWay()};
        }
        case MsgType.X402TipAction: {
            return await tipActionForTweet(request.data as x402TipPayload);
        }

        case MsgType.WalletUnlock: {
            return await msgUnlockWallet(request.data as string);
        }

        case MsgType.WalletSignMessage: {
            return await msgSignMsg(request.data);
        }

        case MsgType.WalletTransferEth: {
            return await msgTransferEth(request.data as transEthParam)
        }

        case MsgType.WalletTransferUSDC: {
            return await msgTransferUsdc(request.data as transUsdcParam);
        }

        case MsgType.WalletExportPrivateKey: {
            return await msgExportPriKye(request.data as string);
        }

        case MsgType.X402EmbeddWalletSignIn: {
            return {success: true, data: await walletSignedIn()};
        }

        default:
            return {success: false, data: "unsupportable message type"};
    }
}


export async function sendMessageToX(action: string, data: any, onlyFirstTab: boolean = true, url = '*://x.com/*'): Promise<any> {
    const tabs = await browser.tabs.query({
        url: url
    });

    if (tabs.length === 0) {
        console.log(`------>>> x is not open!`);
        return {success: false, data: noXTabError}
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
            return {success: false, data: (err as Error).message};
        }
    }

    return {success: true};
}
