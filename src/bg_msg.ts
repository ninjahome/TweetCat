import browser, {Runtime} from "webextension-polyfill";
import {MsgType} from "./consts";
import {kolsForCategory, loadCategories} from "./category";

export function bgMsgDispatch(request: any, _sender: Runtime.MessageSender, sendResponse: (response?: any) => void): true {

    switch (request.action) {
        case MsgType.OpenPlugin:
            openPlugin(request.data).then();
            sendResponse({success: true});
            break;

        case MsgType.QueryKolByCatID:
            kolsForCategory(request.data).then(data => {
                sendResponse({success: true, data: Array.from(data.entries())});
            }).catch(err => {
                sendResponse({success: false, data: err.message});
            });
            break;

        case MsgType.QueryCatsByUser:
            loadCategories(request.data).then(data=>{
                sendResponse({success: true, data: data});
            }).catch(err=>{
                sendResponse({success: false, data: err.message});
            });
            break;

        default:
            sendResponse({success: true});
            break;
    }

    return true;
}

async function openPlugin(data: any) {
    await browser.action.openPopup();
    await browser.runtime.sendMessage({action: MsgType.InitPopup, data: data})
}
