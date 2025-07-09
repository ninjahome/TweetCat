import {observeSimple} from "./utils";
import {parseContentHtml} from "./content";
import {fetchTweets} from "./tweet_api";
import {renderTweetHTML} from "./tweet_render";

/**
 * =========================================
 * TweetCat Timeline – history‑aware version (TS ≤4.9 compatible)
 *   • lightweight view router (native ⇄ tweetcat)
 *   • scroll position memory for each view
 *   • URL hash `#/tweetCatTimeLine` for deep‑link & sharing
 * =========================================
 */

type ViewName = "native" | "tweetcat";

type ViewState = {
    view: ViewName;
    scroll?: number;
};

const SELF_DEFINE_HASH = "#/tweetCatTimeLine";

/** *************************** */

/** UI helpers */
/** *************************** */
function hideOriginalTweetArea(el: HTMLElement) {
    el.style.position = "absolute";
    el.style.top = "-9999px";
    el.style.left = "-9999px";
    el.style.width = "1px";
    el.style.height = "1px";
    el.style.overflow = "hidden";
    el.style.pointerEvents = "none";
    el.style.visibility = "hidden";
}

function showOriginalTweetArea(el: HTMLElement) {
    el.style.position = "";
    el.style.top = "";
    el.style.left = "";
    el.style.width = "";
    el.style.height = "";
    el.style.overflow = "";
    el.style.pointerEvents = "";
    el.style.visibility = "";
}

/** *************************** */

/** Main entry – append menu item */
/** *************************** */
export function appendTweetCatMenuItem(): void {
    observeSimple(
        document.body,
        () => document.querySelector("header nav[role='navigation']") as HTMLElement,
        (menuList) => {
            // already injected?
            if (menuList.querySelector(".tweetCatMenuItem")) return true;

            // load HTML template & mount UI
            parseContentHtml("html/content.html").then((tpl) => {
                setupTweetCatUI(menuList, tpl);
            });
            return true;
        },
    );
}

/** *************************** */

/**  Router + UI assembly       */
/** *************************** */
function setupTweetCatUI(menuList: HTMLElement, tpl: HTMLTemplateElement) {
    // clone nodes
    const tweetCatMenuItem = tpl.content
        .getElementById("tweetCatMenuItem")!
        .cloneNode(true) as HTMLAnchorElement;
    tweetCatMenuItem.classList.add("tweetCatMenuItem");

    const tweetCatArea = tpl.content
        .getElementById("tweetCatArea")!
        .cloneNode(true) as HTMLElement;
    tweetCatArea.style.display = "none";

    // mount
    const mainArea = document.querySelector("main[role='main']") as HTMLElement;
    const originalArea = mainArea.firstElementChild as HTMLElement;

    menuList.insertBefore(tweetCatMenuItem, menuList.children[1] ?? null);
    mainArea.insertBefore(tweetCatArea, originalArea);

    /** view switch */
    const setView = (view: ViewName, restoreScroll?: number) => {
        if (view === "tweetcat") {
            hideOriginalTweetArea(originalArea);
            tweetCatArea.style.display = "block";
            if (!tweetCatArea.querySelector(".tweetTimeline")!.childElementCount) {
                const tl = tweetCatArea.querySelector(".tweetTimeline") as HTMLElement;
                fillTweetAreaByTweets(tl, tpl).catch(console.error);
            }
        } else {
            showOriginalTweetArea(originalArea);
            tweetCatArea.style.display = "none";
        }

        if (typeof restoreScroll === "number") {
            window.scrollTo({top: restoreScroll, behavior: "instant" as any});
        } else {
            window.scrollTo({top: 0});
        }
    };

    /** router init */
    const initRouter = () => {
        if (!history.state || !("view" in history.state)) {
            const firstView: ViewName =
                location.hash === SELF_DEFINE_HASH ? "tweetcat" : "native";
            history.replaceState({view: firstView} as ViewState, "", location.href);
        }
        setView((history.state as ViewState).view);

        window.addEventListener("popstate", (ev) => {
            const state = (ev.state || {}) as ViewState;
            setView(state.view ?? "native", state.scroll);
        });
    };

    /** native click */
    const onNativeMenuClick = () => {
        const cur = history.state as ViewState;
        if (cur?.view === "native") return;

        history.replaceState({view: "tweetcat", scroll: window.scrollY} as ViewState, "", SELF_DEFINE_HASH);
        history.pushState({view: "native"} as ViewState, "", location.pathname);
        setView("native");
    };

    /** tweetcat click */
    const onTweetCatMenuClick = (ev: MouseEvent) => {
        ev.preventDefault();
        const cur = history.state as ViewState;
        if (cur?.view === "tweetcat") return;

        history.replaceState({view: "native", scroll: window.scrollY} as ViewState, "", location.pathname);
        history.pushState({view: "tweetcat"} as ViewState, "", SELF_DEFINE_HASH);
        setView("tweetcat");
    };

    // attach events
    menuList.querySelectorAll("a").forEach((a) => {
        if (a === tweetCatMenuItem) return;
        a.addEventListener("click", onNativeMenuClick, {capture: true});
    });
    tweetCatMenuItem.addEventListener("click", onTweetCatMenuClick);

    initRouter();
}

/** programmatic nav */
export function switchToTweetCatTimeLine() {
    (document.getElementById("tweetCatMenuItem") as HTMLAnchorElement)?.click();
}

/** timeline rendering */
async function fillTweetAreaByTweets(area: HTMLElement, tpl: HTMLTemplateElement) {
    const {tweets} = await fetchTweets("1315345422123180033", 20);
    const nodes: HTMLElement[] = [];

    for (const entry of tweets) {
        const node = renderTweetHTML(entry, tpl);
        area.appendChild(node);
        nodes.push(node);
    }

    let offset = 0;
    for (const node of nodes) {
        await waitForStableHeight(node);
        node.style.transform = `translateY(${offset}px)`;
        offset += node.offsetHeight;
    }
    area.style.height = `${offset}px`;
}

function waitForStableHeight(el: HTMLElement): Promise<void> {
    return new Promise((resolve) => {
        let last = el.offsetHeight;
        let stable = 0;
        const check = () => {
            const cur = el.offsetHeight;
            if (cur === last) {
                if (++stable >= 2) return resolve();
            } else {
                stable = 0;
                last = cur;
            }
            requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
    });
}

// stubs
async function loadCachedTweets() {
}

async function pullTweetsFromSrv() {
}
