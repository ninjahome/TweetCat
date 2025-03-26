import browser, {Runtime} from "webextension-polyfill";
import {MsgType, TweetKol} from "./consts";
import {kolsForCategory, loadCategories, removeKolsCategory, updateKolsCategory} from "./category";
import {databaseUpdate} from "./database";

export async function bgMsgDispatch(request: any, _sender: Runtime.MessageSender, sendResponse: (response?: any) => void) {

    switch (request.action) {
        case MsgType.OpenPlugin:
            await openPlugin(request.data);
            sendResponse({success: true});
            break;

        case MsgType.QueryKolByCatID:
            const data = await kolsForCategory(request.data);
            sendResponse({success: true, data: Array.from(data.entries())});
            break;

        case MsgType.QueryCatsByUser:
            sendResponse({success: true, data: await loadCategories(request.data)});
            break;

        case MsgType.NewCategoryAdd:
            broadcastToContent(MsgType.NewCategoryAdd, await loadCategories(request.data));
            sendResponse({success: true});
            break;

        case MsgType.UpdateKolCat:
            await updateKolsCategory(request.data as TweetKol);
            sendResponse({success: true});
            break;
        case MsgType.RemoveKol:
            await removeKolsCategory(request.data);
            sendResponse({success: true});
            break;
        default:
            sendResponse({success: true});
            break;
    }
}

async function openPlugin(data: any) {
    await browser.action.openPopup();
    await browser.runtime.sendMessage({action: MsgType.InitPopup, data: data})
}

function broadcastToContent(action: string, data: any) {
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
