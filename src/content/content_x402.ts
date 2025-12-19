import {EntryObj} from "../timeline/tweet_entry";
import {_contentTemplate} from "./twitter_observer";
import {logX402} from "../common/debug_flags";
import {sendMsgToService} from "../common/utils";
import {MsgType} from "../common/consts";
import {hideGlobalLoading, showGlobalLoading} from "./common";
import {showToastMsg} from "../timeline/render_common";
import {LRUCache} from "../common/lru_map";
import {showAlert} from "../popup/common";
import {t} from "../common/i18n";
import {walletInfo} from "../wallet/wallet_api";
import {x402TipPayload} from "../common/x402_obj";

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
        const resp = await sendMsgToService({}, MsgType.WalletInfoQuery)
        if (!resp || !resp.success) {
            showAlert(t('tips_title'), t('wallet_err_no_basic'))
            return
        }
        const data = resp.data as walletInfo
        if (!data.hasCreated) {
            showAlert(t('tips_title'), t('wallet_error_no_wallet'))
            return
        }
        const usdc = Number(data.usdcVal ?? 0)

        if (!Number.isFinite(usdc) || usdc < tip) {
            showAlert(t('tips_title'),t('wallet_insufficient_funds') + ` USDC ${tip} Needed`)
            return
        }

        logX402("------>>> tip action clicked:")
        const tweet = obj.tweet
        const payload: x402TipPayload = {tweetId: tweet.rest_id, authorId: tweet.author.authorID, usdcVal: tip}
        const req = await sendMsgToService(payload, MsgType.X402TipAction)
        console.log("x402 req:", req)
        if (!req.success) {
            showToastMsg(req.data as string)
            return
        }
    } catch (e) {
        showToastMsg(e.toString())
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
