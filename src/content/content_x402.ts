import {EntryObj} from "../timeline/tweet_entry";
import {_contentTemplate, findTweetIDOfTweetDiv} from "./twitter_observer";
import {logX402} from "../common/debug_flags";
import {sendMsgToService, sleep} from "../common/utils";
import {MsgType} from "../common/consts";
import {t} from "../common/i18n";
import {hideGlobalLoading, showGlobalLoading} from "./common";
import {showDialog, showToastMsg} from "../timeline/render_common";
import {ar} from "date-fns/locale/ar";

function findArticleByStatusId(statusId: string): HTMLElement | null {
    // 使用属性选择器查找包含指定状态ID的链接
    const selector = `a[href*="/status/${statusId}"]`;
    const link = document.querySelector<HTMLAnchorElement>(selector);

    // 如果找到链接，则向上查找最近的article元素
    if (link) {
        return link.closest('article');
    }

    return null;
}

const tweetsCache = new Map<string, EntryObj>()

export async function cacheTweetInStatus(tweets: EntryObj[], tryAgain: boolean = false) {
    if (tweets.length === 0) return


    tweets.forEach(obj => {
        const statusId = obj.tweet.rest_id
        tweetsCache.set(statusId, obj)
    })

    const firstTweetObj = tweets[0]

    const tweetId = firstTweetObj.tweet.rest_id
    const article = findArticleByStatusId(tweetId)
    if (!article) {
        if (tryAgain) {
            console.warn("failed to find tweet article")
            return
        }
        setTimeout(() => {
            cacheTweetInStatus(tweets, true)
        }, 1_000)
        return
    }

    appendTipBtn(article, firstTweetObj)
}

function appendTipBtn(article: HTMLElement, obj: EntryObj) {
    const toolBar = article.querySelector(".css-175oi2r.r-1awozwy.r-18u37iz.r-1cmwbt1.r-1wtj0ep")
    if (!!toolBar.querySelector(".user-tip-action"))return;

    const tipBtn = _contentTemplate.content.getElementById("user-tip-action")?.cloneNode(true) as HTMLElement;
    if (!tipBtn) return;
    tipBtn.removeAttribute("id")

    toolBar.insertBefore(tipBtn, toolBar.firstChild)
    tipBtn.onclick = async function () {
        await tipAction(obj)
    }
}

async function tipAction(firstTweetObj: EntryObj) {
    showGlobalLoading("正在访问 X402 服务")
    try {
        logX402("------>>> tip action clicked:")
        const tweet = firstTweetObj.tweet
        const req = await sendMsgToService({
            tweetId: tweet.rest_id,
            authorId: tweet.author.authorID
        }, MsgType.X402TipAction)
        console.log("x402 req:", req)
        if(!req.success){
            showToastMsg(req.data as string)
            return
        }
    } catch (e) {
        showToastMsg("打赏失败：" + e.toString())
    } finally {
        hideGlobalLoading()
    }
}

function getTweetById(statusId: string): EntryObj | undefined {
    return tweetsCache.get(statusId)
}

export function addTipBtnForTweetDetail(mainTweetID: string) {
    console.log("-------->>> main tweet id:", mainTweetID)
    const article = findArticleByStatusId(mainTweetID)
    console.log("------->>>", article)
    const obj = tweetsCache.get(mainTweetID)
    if (!obj) {
        console.log("no data for main tweet")
        return
    }
}

export function addTipBtnForTweet(divNode: HTMLDivElement) {

    const statusId = findTweetIDOfTweetDiv(divNode);
    if (!statusId) {
        return
    }
    const obj = tweetsCache.get(statusId)
    logX402("-------->>> find tweet:", statusId, obj)
    const article = divNode.querySelector('article') as HTMLElement
    if(!obj || !article)return;
    appendTipBtn(article, obj)
}
