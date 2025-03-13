import browser, {Runtime} from "webextension-polyfill";
import {MsgType} from "./consts";

export function bgMsgDispatch(request: any, _sender: Runtime.MessageSender, sendResponse: (response?: any) => void): true {

    switch (request.action) {
        case MsgType.OpenPlugin:
            openPlugin(request.data, sendResponse).then();
            break;
    }
    return true;
}

async function openPlugin(data: any, sendResponse: (response: any) => void) {
    await browser.action.openPopup();
    await browser.runtime.sendMessage({action: MsgType.InitPopup, data: data})
    sendResponse({success: true});
}