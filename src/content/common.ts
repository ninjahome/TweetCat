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

export function showDialog(title: string, content: string, callback?: DialogCallback) {

    const dialog = document.getElementById("tw-dialog-overlay") as HTMLElement;
    if (!dialog) return;

    (dialog.querySelector(".tw-dialog-title") as HTMLElement).innerText = title;
    (dialog.querySelector(".tw-dialog-text") as HTMLElement).innerText = content;

    dialog.style.setProperty('display', 'flex', 'important');

    const dialogConfirm = dialog.querySelector(".tw-dialog-btn-confirm") as HTMLButtonElement;
    dialogConfirm.addEventListener('click', async () => {
        dialog.style.setProperty('display', 'none', 'important');
        await callback?.()
    }, {once: true});

}


export function showToastMsg(msg: string, timeout: number = 3) {
    let root = document.getElementById('tweet-toast') as HTMLElement;
    const msgSpan = root.querySelector(".tweet-toast__msg") as HTMLSpanElement;
    if (root.style.display === 'flex') {
        msgSpan.innerText = msg;
        return;
    }

    root.style.display = 'flex';
    msgSpan.innerText = msg;

    setTimeout(() => {
        root.style.display = 'none';
        msgSpan.innerText = '';
    }, timeout * 1000);
}

export const ADS_FOLLOW_UI_MODE = {
    Loading: "loading",
    Eligible: "eligible",
    AlreadyFollowing: "already_following",
    Processing: "processing",
    Claimed: "claimed",
} as const;

export type AdsFollowUiMode = typeof ADS_FOLLOW_UI_MODE[keyof typeof ADS_FOLLOW_UI_MODE];

export const ADS_FOLLOW_CLAIM_STATUS = {
    Processing: "processing",
    ClaimedPendingProof: "claimed_pending_proof",
} as const;

export type AdsFollowClaimStatus = typeof ADS_FOLLOW_CLAIM_STATUS[keyof typeof ADS_FOLLOW_CLAIM_STATUS];
