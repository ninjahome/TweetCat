import browser, {Runtime} from "webextension-polyfill";
import {MsgType} from "../common/consts";
import {
    CategoryForId,
    loadCategories,
    queryKolByName,
    removeKolsCategory,
    updateKolsCategory
} from "../object/category";
import {kolsForCategory, loadAllKols, TweetKol} from "../object/tweet_kol";
import {
    cacheRawTweets,
    initTweetsCheck,
    loadCachedTweetsByUserId,
    loadLatestTweets,
    WrapEntryObj
} from "../timeline/db_raw_tweet";
import {loadAllKolCursors, writeKolsCursors} from "../object/kol_cursor";

export async function bgMsgDispatch(request: any, _sender: Runtime.MessageSender) {
    // console.log("-----------bgMsgDispatch-------------->>>_sender is: ", request)

    switch (request.action) {

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

        case MsgType.KolQueryAll: {
            return {success: true, data: await loadAllKols()};
        }
        case MsgType.KolCursorLoadAll: {
            return {success: true, data: await loadAllKolCursors()};
        }

        case MsgType.KolCursorWriteBack: {
            await writeKolsCursors(request.data);
            return {success: true};
        }

        default:
            return {success: false, data: "unsupportable message type"};
    }
}

async function openPlugin() {
    await browser.action.openPopup();
}

export function broadcastToContent(action: string, data: any) {
    browser.tabs.query({}).then((tabs) => {
        for (const tab of tabs) {
            if (tab.id !== undefined) {  // 确保 tab.id 存在
                browser.tabs.sendMessage(tab.id, {
                    action: action,
                    data: data
                }).catch(err => {
                    // 捕获某些tab没有注入content script时的错误
                    console.log(`------>>>Tab ${tab.id} 无法接收消息:`, err);
                });
            }
        }
    });
}
