import {EntryObj} from "../timeline/tweet_entry";

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

export async function addTipButtonForTweet(tweets: EntryObj[]) {
    tweets.forEach(obj=>{
        const statusId = obj.tweet.rest_id
        const article = findArticleByStatusId(statusId);
        if (article) {
            console.log("------>>>found:", article)
        } else {
            console.log("not found:", statusId)
        }
    })
}