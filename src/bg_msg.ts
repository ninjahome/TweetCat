import browser, {Runtime} from "webextension-polyfill";
import {MsgType} from "./consts";
import {
    CategoryForId,
    kolsForCategory,
    loadCategories,
    queryKolByName,
    removeKolsCategory,
    updateKolsCategory
} from "./category";
import {TweetKol} from "./object_TweetKol";
import {cacheRawTweets, initTweetsCheck, loadCachedTweetsByUserId, WrapEntryObj} from "./timeline/db_raw_tweet";

export async function bgMsgDispatch(request: any, _sender: Runtime.MessageSender) {
    // console.log("-----------bgMsgDispatch-------------->>>_sender is: ", request)

    switch (request.action) {

        case MsgType.OpenPlugin: {
            await openPlugin();
            return {success: true};
        }

        case MsgType.QueryKolByCatID: {
            const data = await kolsForCategory(request.data);
            return {success: true, data: Array.from(data.entries())};
        }

        case MsgType.QueryCatsByUser: {
            const catData = await loadCategories(request.data);
            // console.log("------------------------->>>catData is: ", catData)
            return {success: true, data: catData};
        }

        case MsgType.QueryCatByID: {
            const catData = await CategoryForId(request.data);
            return {success: true, data: catData};
        }

        case MsgType.UpdateKolCat: {
            await updateKolsCategory(request.data as TweetKol);
            return {success: true};
        }

        case MsgType.RemoveKol:
            await removeKolsCategory(request.data);
            return {success: true};

        case MsgType.QueryKolCat: {
            const kolCat = await queryKolByName(request.data)
            return {success: true, data: kolCat};
        }

        case MsgType.CacheRawTweetData: {
            await cacheRawTweets(request.data as WrapEntryObj[]);
            return {success: true};
        }

        case MsgType.ReadTweetByKolIdFromDBCache: {
            const reqData = request.data;
            const data = await loadCachedTweetsByUserId(reqData.kolId, reqData.limit)
            return {success: true, data: data};
        }

        case MsgType.TweetsBootStrap:
            const data = await initTweetsCheck()
            return {success: true, data: data};

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
