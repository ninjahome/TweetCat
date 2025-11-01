import {observeSimple, sendMsgToService} from "../common/utils";
import {MsgType} from "../common/consts";

export function confirmUsrInfo() {
    observeSimple(
        document.body,
        () => document.querySelector("header nav[role='navigation']") as HTMLElement,
        (nav) => {
            const userInfoArea = document.body.querySelector("button[data-testid='SideNav_AccountSwitcher_Button']") as HTMLElement
            const imgElm = userInfoArea?.querySelector("div[data-testid='UserAvatar-Container-TweetCatOrg'] img") as HTMLImageElement;
            if (!userInfoArea || !imgElm) return false;

            console.log("------->>> user info:", userInfoArea.textContent, imgElm.src);

            sendMsgToService({}, MsgType.KolCursorLoadAll).then(rsp=>{
                if (!rsp.success || !rsp.data) {
                    return
                }

                //TODO::query user's tweet info
            });
            return true;
        }
    );
}