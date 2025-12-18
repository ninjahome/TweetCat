import {EntryObj} from "../timeline/tweet_entry";
import {_contentTemplate} from "./twitter_observer";
import {logX402} from "../common/debug_flags";
import {sendMsgToService} from "../common/utils";
import {MsgType} from "../common/consts";
import {hideGlobalLoading, showGlobalLoading} from "./common";
import {showToastMsg} from "../timeline/render_common";
import {LRUCache} from "../common/lru_map";

const tweetsCache = new LRUCache<string, EntryObj>(1000);

export async function cacheTweetInStatus(tweets: EntryObj[]) {
    if (tweets.length === 0) return
    tweets.forEach(obj => {
        const statusId = obj.tweet.rest_id
        tweetsCache.set(statusId, obj)
    })
}

async function tipAction(statusId: string) {
    const obj = tweetsCache.get(statusId)
    if (!obj) {
        //TODO::
        console.warn("should not be nil for:", statusId)
        return
    }
    showGlobalLoading("正在访问 X402 服务")
    try {
        const tip = 0.01

        // 1) 先查钱包信息（复用现有接口）
        const info = await sendMsgToService({}, MsgType.WalletInfoQuery)
        const usdc = Number(info?.data?.usdt ?? 0) // 如果你改名了这里改成 usdc

        if (!Number.isFinite(usdc) || usdc < tip) {
            showToastMsg(`USDC 余额不足：需要 ${tip} USDC`)
            return
        }

        logX402("------>>> tip action clicked:")
        const tweet = obj.tweet
        const req = await sendMsgToService({
            tweetId: tweet.rest_id,
            authorId: tweet.author.authorID,
            val: tip
        }, MsgType.X402TipAction)
        console.log("x402 req:", req)
        if (!req.success) {
            showToastMsg(req.data as string)
            return
        }
    } catch (e) {
        showToastMsg("打赏失败：" + e.toString())
    } finally {
        hideGlobalLoading()
    }
}

export function addTipBtnForTweet(statusId: string, isTryAgain: boolean = false) {
    const article = document.querySelector('div[data-testid="primaryColumn"] article') as HTMLElement
    logX402("-------->>> find tweet when url changed:", statusId, article === null)
    if (!article) {
        if (isTryAgain) return;
        setTimeout(() => {
            addTipBtnForTweet(statusId, true)
        }, 5_000)
        return;
    }

    const toolBar = article?.querySelector(".css-175oi2r.r-1awozwy.r-18u37iz.r-1cmwbt1.r-1wtj0ep")
    if (!toolBar || !!toolBar.querySelector(".user-tip-action")) return;

    const tipBtn = _contentTemplate.content.getElementById("user-tip-action")?.cloneNode(true) as HTMLElement;
    tipBtn.removeAttribute("id")

    toolBar.insertBefore(tipBtn, toolBar.firstChild)
    tipBtn.onclick = async function () {
        await tipAction(statusId)
    }
}

let heartbeatTimer: number | null = null

export function startX402Heartbeat() {
    heartbeatTimer = window.setInterval(() => {
        try {
            sendMsgToService({}, MsgType.X402Heartbeat).then(() => {
                console.log("======>>>>>KA发送成功")
            })
        } catch (err) {
            console.log("---------->>>>>port error:", err)
        }
    }, 20_000)
}