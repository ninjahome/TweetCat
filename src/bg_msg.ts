import browser, {Runtime} from "webextension-polyfill";
import {MsgType, TweetKol} from "./consts";
import {
    CategoryForId,
    kolsForCategory,
    loadCategories,
    queryKolByName,
    removeKolsCategory,
    updateKolsCategory
} from "./category";

export async function bgMsgDispatch(request: any, _sender: Runtime.MessageSender, sendResponse: (response?: any) => void) {

    switch (request.action) {

        case MsgType.OpenPlugin:{
            await openPlugin(request.data);
            sendResponse({success: true});
            return;
        }

        case MsgType.QueryKolByCatID:{
            const data = await kolsForCategory(request.data);
            sendResponse({success: true, data: Array.from(data.entries())});
            return;
        }

        case MsgType.QueryCatsByUser:
        {
            const catData = await  loadCategories(request.data);
            sendResponse({success: true, data: catData});
            return;
        }

        case MsgType.QueryCatByID:
        {
            const catData = await  CategoryForId(request.data);
            sendResponse({success: true, data: catData});
            return;
        }

        case MsgType.CategoryChanged:{
            const changedCat = await  loadCategories(request.data);
            broadcastToContent(MsgType.CategoryChanged, changedCat);
            sendResponse({success: true});
            return;
        }

        case MsgType.UpdateKolCat:{
            await updateKolsCategory(request.data as TweetKol);
            sendResponse({success: true});
            return;
        }

        case MsgType.RemoveKol:
            await removeKolsCategory(request.data);
            sendResponse({success: true});
            return;

        case MsgType.QueryKolCat:{
            const kolCat = await queryKolByName(request.data)
            sendResponse({success: true, data: kolCat});
            return;
        }

        default:
            sendResponse({success: false, data:"unsupportable message type"});
            return;
    }
}

async function openPlugin(data: any) {
    await browser.action.openPopup();
    await browser.runtime.sendMessage({action: MsgType.InitPopup, data: data})
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
