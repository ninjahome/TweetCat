import { t } from "../common/i18n";

export function showGlobalLoading(title: string, details: string = "") {
    const gwo = document.getElementById("global-wait-overlay") as HTMLElement;
    const detail = document.getElementById("global-wait-detail") as HTMLElement;
    const titleSpn = gwo.querySelector(".wait-title") as HTMLElement

    gwo.style.display = "block";
    detail.innerText = details;
    titleSpn.innerText = title;
}

export function hideGlobalLoading() {
    const gwo = document.getElementById("global-wait-overlay") as HTMLElement;
    gwo.style.display = "none";
}


type DialogCallback = () => void | Promise<void>;

export function showDialog(title: string, content: string, callback?: DialogCallback, confirmText?: string) {
    // There might be multiple dialogs because of cloning or re-initialization. Update all to be safe.
    const dialogs = document.querySelectorAll("#tw-dialog-overlay");
    if (dialogs.length === 0) {
        console.warn("[TwitterUI] showDialog failed: No #tw-dialog-overlay found in DOM.");
        return;
    }

    dialogs.forEach(dialog => {
        const titleEl = dialog.querySelector(".tw-dialog-title") as HTMLElement;
        const textEl = dialog.querySelector(".tw-dialog-text") as HTMLElement;
        const dialogConfirm = dialog.querySelector(".tw-dialog-btn-confirm") as HTMLButtonElement;

        if (titleEl) titleEl.textContent = title;
        if (textEl) textEl.textContent = content;

        (dialog as HTMLElement).style.setProperty('display', 'flex', 'important');

        if (dialogConfirm) {
            dialogConfirm.textContent = confirmText || t('confirm') || "确认";
            dialogConfirm.onclick = async () => {
                (dialog as HTMLElement).style.setProperty('display', 'none', 'important');
                await callback?.();
            };
        }
    });
}


export function showToastMsg(msg: string, timeout: number = 3) {
    let root = document.getElementById('tweet-toast') as HTMLElement;
    if (!root) return;
    const msgSpan = root.querySelector(".tweet-toast__msg") as HTMLSpanElement;
    if (!msgSpan) return;

    if (root.style.display === 'flex') {
        msgSpan.innerText = msg;
        return;
    }

    root.style.display = 'flex';
    msgSpan.innerText = msg;

    // Support both seconds and milliseconds. If > 100, assume ms.
    const delay = timeout > 100 ? timeout : timeout * 1000;

    setTimeout(() => {
        root.style.display = 'none';
        msgSpan.innerText = '';
    }, delay);
}

export const ADS_FOLLOW_UI_MODE = {
    Loading: "loading",
    Eligible: "eligible",
    AlreadyFollowing: "already_following",
    Processing: "processing",
    Claimed: "claimed",
    AlreadyClaimed: "already_claimed",
} as const;

export type AdsFollowUiMode = typeof ADS_FOLLOW_UI_MODE[keyof typeof ADS_FOLLOW_UI_MODE];

export const ADS_FOLLOW_CLAIM_STATUS = {
    Processing: "processing",
    ClaimedPendingProof: "claimed_pending_proof",
    Claimed: "claimed",
} as const;

export type AdsFollowClaimStatus = typeof ADS_FOLLOW_CLAIM_STATUS[keyof typeof ADS_FOLLOW_CLAIM_STATUS];
