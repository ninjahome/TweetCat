import browser, {Runtime} from "webextension-polyfill";
import {MsgType} from "./consts";
import {fetchAllKolsTweets} from "./bg_web";

export function bgMsgDispatch(request: any, _sender: Runtime.MessageSender, sendResponse: (response?: any) => void): true {

    switch (request.action) {
        case MsgType.OpenPlugin:
            openPlugin(request.data).then();
            sendResponse({success: true});
            break;
        case MsgType.QueryKolTweets:
            fetchAllKolsTweets(request.data,sendResponse).then();
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