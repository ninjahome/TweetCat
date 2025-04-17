import {observeForElement} from "./utils";
import {parseContentHtml} from "./content";

const itemSelClasses = ['r-1kihuf0', 'r-sdzlij', 'r-1p0dtai', 'r-hdaws3', 'r-s8bhmr', 'r-u8s1d', 'r-13qz1uu']

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
        const contentTemplate = await parseContentHtml('html/content.html');
        const clone = contentTemplate.content.getElementById("tweetCat-present-top")!.cloneNode(true) as HTMLElement;

        menuList.querySelectorAll("a").forEach(linkElm => {
            linkElm.addEventListener('click', () => {
                itemSelClasses.forEach(className => {
                    clone.classList.remove(className)
                })
            })
        });

        if (menuList.children.length === 2) {
            menuList.append(clone)
        } else {
            menuList.insertBefore(clone, menuList.children[2])
        }

        clone.onclick = (e) => {
            e.preventDefault();
            pullTweetCatContent(menuList as HTMLElement, clone)
        }

    }, false);
}

function pullTweetCatContent(menuList: HTMLElement, selectedItem: HTMLElement) {

    console.log("------>>>tweetCat content");
    menuList.querySelectorAll("a").forEach(linkElm => {
        linkElm.setAttribute('aria-selected', 'false');
        linkElm.setAttribute('tabindex', '-1');
        const subLineItem = linkElm.querySelector(".css-175oi2r.r-xoduu5") as HTMLElement
        itemSelClasses.forEach(className => {
            subLineItem.classList.remove(className)
        })
        subLineItem.removeAttribute('style');
    })

    selectedItem.setAttribute('aria-selected', 'true');
    selectedItem.removeAttribute('tabindex');
    const subLineItem = selectedItem.querySelector(".css-175oi2r.r-xoduu5") as HTMLElement
    itemSelClasses.forEach(className => {
        subLineItem.classList.add(className)
    })
    subLineItem.setAttribute('style', 'background-color: rgb(29, 155, 240)');
}
