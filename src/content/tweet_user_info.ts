import {observeSimple} from "../common/utils";
import {getUserByUsername} from "../timeline/twitter_api";
import {calculateLevelBreakdown, LevelScoreBreakdown} from "../object/user_info";

export var scoreOfTwitterOwner :LevelScoreBreakdown = null;
export function queryProfileOfTwitterOwner() {
    observeSimple(
        document.body,
        () => document.querySelector("header nav[role='navigation']") as HTMLElement,
        () => {
            const userInfoArea = document.body.querySelector("button[data-testid='SideNav_AccountSwitcher_Button']") as HTMLElement
            if (!userInfoArea) return false;
            const [displayName = '', userName = ''] = userInfoArea.textContent.split('@');
            console.log("------->>> displayName:", displayName, "userName:", userName);
            getUserByUsername(userName).then(data => {
                scoreOfTwitterOwner = calculateLevelBreakdown(data);
                console.log("------>>> user data:", data, " \n score:", scoreOfTwitterOwner);
            });
            return true;
        }
    );
}

