import {initUserTweetsCapture} from "./inject_tweet_fetch"
import {initPagePatch} from "./inject_router";
import {TcMessage} from "./common/injection_msg";

/** 向 content-script 广播路由变化 */
export function postToContent(action: string, data?: unknown): void {
    const msg = new TcMessage(action, true, data);
    window.postMessage(msg, '*'); // structured clone，安全传对象
}

function initInjection() {
    initPagePatch();
    initUserTweetsCapture();
}

initInjection();
