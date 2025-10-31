import {observeSimple} from "../common/utils";

export function confirmUsrInfo() {
    observeSimple(
        document.body,
        () => document.querySelector("header nav[role='navigation']") as HTMLElement,
        (nav) => {
            const userInfoArea = document.body.querySelector("button[data-testid='SideNav_AccountSwitcher_Button']") as HTMLElement
            const imgElm = userInfoArea?.querySelector("div[data-testid='UserAvatar-Container-TweetCatOrg'] img") as HTMLImageElement;
            if (!userInfoArea || !imgElm) return false;

            console.log("------->>> user info:", userInfoArea.textContent, imgElm.src);

            return true;
        }
    );
}