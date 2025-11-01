import {observeSimple, sendMsgToService} from "../common/utils";
import {MsgType} from "../common/consts";
import {getUserByUsername} from "../timeline/twitter_api";
import {calculateLevel, calculateLevelBreakdown} from "../object/user_info";

export function confirmUsrInfo() {
    observeSimple(
        document.body,
        () => document.querySelector("header nav[role='navigation']") as HTMLElement,
        () => {
            const userInfoArea = document.body.querySelector("button[data-testid='SideNav_AccountSwitcher_Button']") as HTMLElement
            if (!userInfoArea) return false;
            const [displayName = '', userName = ''] = userInfoArea.textContent.split('@');
            console.log("------->>> displayName:", displayName, "userName:", userName);
            getUserByUsername(userName).then(data => {
                console.log("------>>> user data:", data, " \n score:", calculateLevelBreakdown(data));
            });

            sendMsgToService({}, MsgType.UserUpdateInfo).then(rsp => {
                if (!rsp.success || !rsp.data) {
                    return
                }
                //TODO::query user's tweet info
            });
            return true;
        }
    );
}