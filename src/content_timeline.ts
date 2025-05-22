import {observeSimple} from "./utils";
import {parseContentHtml} from "./content";
import {fetchTweets} from "./content_tweet_api";
import {renderTweetHTML} from "./tweet_render";

const selfDefineUrl = 'tweetCatTimeLine';

export function appendTweetCatMenuItem() {
    const header = document.querySelector('header[role="banner"]') as HTMLElement;
    console.log("---------------------->>>header area:", header);
    observeSimple(document.body, () => {
        return document.querySelector('header nav[role="navigation"]') as HTMLElement;
    }, (menuList) => {
        if (!!menuList.querySelector(".tweetCatMenuItem")) {
            return true;
        }

        parseContentHtml('html/content.html').then(contentTemplate => {
            const tweetCatMenuItem = contentTemplate.content.getElementById("tweetCatMenuItem")!.cloneNode(true) as HTMLElement;
            const tweetCatArea = contentTemplate.content.getElementById("tweetCatArea")!.cloneNode(true) as HTMLElement;

            const mainArea = document.querySelector('main[role="main"]') as HTMLElement;
            const originalTweetArea = mainArea.firstChild as HTMLElement;

            menuList.querySelectorAll("a").forEach(elm => {
                elm.addEventListener('click', () => {
                    tweetCatArea.style.display = 'none';
                    originalTweetArea.style.display = 'block';
                });
            });

            tweetCatMenuItem.onclick = (ev) => {
                ev.preventDefault();
                originalTweetArea.style.display = 'none';
                tweetCatArea.style.display = 'block';
                history.replaceState({id: 123}, '', '/#/' + selfDefineUrl);
                const tweetCatTimeLine = tweetCatArea.querySelector(".tweetTimeline") as HTMLElement;
                tweetCatTimeLine.innerHTML = '';
                fillTweetAreaByTweets(tweetCatTimeLine, contentTemplate).then();
            }

            menuList.insertBefore(tweetCatMenuItem, menuList.children[1]);
            mainArea.insertBefore(tweetCatArea, originalTweetArea);
        });

        return true;
    })
}

export function switchToTweetCatTimeLine() {
    const tweetCatMenuItem = document.getElementById("tweetCatMenuItem") as HTMLAnchorElement;
    tweetCatMenuItem.click();
}

async function fillTweetAreaByTweets(tweetCatArea: HTMLElement, contentTemplate: HTMLTemplateElement) {
    const validTweets = await fetchTweets('1551261351347109888', 20); // 1899045104146644992 // 1551261351347109888
    const tweetNodes: HTMLElement[] = [];

    for (const entry of validTweets.tweets) {
        const tweetNode = renderTweetHTML(entry, contentTemplate);
        tweetCatArea.appendChild(tweetNode);
        tweetNodes.push(tweetNode);
    }

    let cumulativeOffset = 0;
    for (const tweetNode of tweetNodes) {
        await waitForStableHeight(tweetNode);
        tweetNode.style.transform = `translateY(${cumulativeOffset}px)`;
        cumulativeOffset += tweetNode.offsetHeight;
    }

    tweetCatArea.style.height = cumulativeOffset + 'px'; // 设置容器高度
}

function waitForStableHeight(el: HTMLElement): Promise<void> {
    return new Promise((resolve) => {
        let lastHeight = el.offsetHeight;
        let stableCount = 0;

        const check = () => {
            const currentHeight = el.offsetHeight;
            if (currentHeight === lastHeight) {
                stableCount++;
            } else {
                stableCount = 0;
                lastHeight = currentHeight;
            }

            if (stableCount >= 2) {
                resolve();
            } else {
                requestAnimationFrame(check);
            }
        };

        requestAnimationFrame(check);
    });
}

async function loadCachedTweets() {
}

async function pullTweetsFromSrv() {
}

