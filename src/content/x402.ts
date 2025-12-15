import {EntryObj} from "../timeline/tweet_entry";
import {findTweetIDOfTweetDiv} from "./twitter_observer";

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

export async function cacheTweetInStatus(tweets: EntryObj[]) {
    console.log("----->>> tweets length:", tweets.length)
    tweets.forEach(obj => {
        const statusId = obj.tweet.rest_id
        tweetsCache.set(statusId, obj)
    })
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
    console.log("-------->>> find tweet:", statusId, obj)
}