import {showAlert} from "./common";
import {t} from "../common/i18n";
import {localGet, localRemove} from "../common/local_storage";
import {logX402} from "../common/debug_flags";
import {MsgType, X402TaskKey} from "../common/consts";
import {requestPassword} from "./password_modal";
import {sendMsgToService} from "../common/utils";

export async function processX402Task() {
    const x402_popup_task = await localGet(X402TaskKey)
    logX402("------>>> popup task", x402_popup_task)
    if (!x402_popup_task) return;

    try {
        switch (x402_popup_task.type) {
            case MsgType.X402WalletOpen: {
                const password = await requestPassword("创建 x402 Session（仅一次）")
                const rsp = await sendMsgToService(password, MsgType.WalletUnlock)
                if (!rsp || !rsp.success) {
                    showAlert("Error", t('decrypt_info_failed'))
                    return
                }
                break
            }
            default: {
                logX402("------>>> popup task type unresolved", x402_popup_task.type)
                break
            }
        }
    } finally {
        await localRemove(X402TaskKey)
    }
}
