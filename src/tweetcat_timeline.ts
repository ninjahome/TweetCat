import {observeForElement} from "./utils";
import {parseContentHtml} from "./content";

export async function appendCatPresent() {
    observeForElement(document.body, 3000, () => {
        const navDiv = document.querySelector('nav[aria-live="polite"][role="navigation"]');
        const menuList = navDiv?.querySelector('div[role="tablist"]')
        return menuList as HTMLElement
    }, async () => {

        const menuList = document.querySelector('nav[aria-live="polite"][role="navigation"] div[role="tablist"]');
        if (!menuList || menuList.children.length < 2) {
            console.warn("------>>> failed to find top menu [for you] [following]")
            return;
        }

        console.log("------>>>nav div", menuList);

        const contentTemplate = await parseContentHtml('html/content.html');
        const tweetCatDiv = contentTemplate.content.getElementById("tweetCat-present-top")!;
        if (menuList.children.length === 2) {
            menuList.insertBefore(tweetCatDiv, menuList.lastChild)
        } else {
            menuList.insertBefore(tweetCatDiv, menuList.children[2])
        }

    }, false);
}