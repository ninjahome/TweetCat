import {initUserTweetsCapture} from "./inject_tweet_fetch"
import {initPagePatch} from "./inject_router";

function initInjection(): void {
    initPagePatch();
    initUserTweetsCapture();
    // installTxidGenAndDump();
}

initInjection();