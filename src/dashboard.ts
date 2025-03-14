import browser, {Runtime} from "webextension-polyfill";
import {MsgType} from "./consts";
import {initDatabase} from "./database";
import {showView} from "./utils";

console.log('------>>>Happy developing ✨')
document.addEventListener("DOMContentLoaded", initDashBoard as EventListener);

let routeTarget = "";

async function initDashBoard(): Promise<void> {
    await initDatabase();

    if (routeTarget) {
        showView(routeTarget, dashRouter);
    } else {
        showView('#onboarding/main-home', dashRouter);
    }
}

function dashRouter(path: string): void {
    // console.log("------>>> show view for path:", path);
    if (path === '#onboarding/main-home') {
    } else if (path === '#onboarding/category-manager') {
    }
}

browser.runtime.onMessage.addListener((request: any, _sender: Runtime.MessageSender, sendResponse: (response?: any) => void): true => {
    return dashboardMsgDispatch(request, _sender, sendResponse)
});

export function dashboardMsgDispatch(request: any, _sender: Runtime.MessageSender, sendResponse: (response?: any) => void): true {
    switch (request.action) {

        case MsgType.InitPopup:
            console.log("------>>> init pop up for path:", request.data);
            routeTarget = request.data;
            sendResponse({success: true});
            break;

        default:
            sendResponse({success: true});
            break;
    }
    return true;
}