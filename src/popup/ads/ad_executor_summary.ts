import { $2, atomicToUsdcNumber, cloneTemplate, formatUSDC, getCurrentUserInfo, showNotification } from "../common";
import { x402WorkerGet } from "../../wallet/cdp_wallet";
import { API_PATH_ADS_MY_CLAIMS } from "./ad_publisher_common";
import { EarnClaim, executorState, formatClaimTime } from "./ad_executor_common";

export async function loadClaims(): Promise<EarnClaim[]> {
    const { xId } = await getCurrentUserInfo();
    const response = await x402WorkerGet(API_PATH_ADS_MY_CLAIMS, { b_x_id: xId });
    return Array.isArray(response) ? (response as EarnClaim[]) : [];
}

export async function loadEarnSummary(): Promise<void> {
    try {
        const claims = await loadClaims();
        executorState.myClaims = claims;

        // 重置统计
        executorState.totalEarnedUSDC = 0;
        executorState.pendingUSDC = 0;
        executorState.withdrawableUSDC = 0;
        executorState.todayEarnedUSDC = 0;

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayTimestamp = today.getTime();

        claims.forEach(claim => {
            const amount = atomicToUsdcNumber(claim.unit_price_atomic);

            if (claim.status === "CLAIMED" || claim.status === "PENDING_CONFIRM") {
                executorState.pendingUSDC += amount;
                executorState.totalEarnedUSDC += amount;
            } else if (claim.status === "CONFIRMED") {
                executorState.withdrawableUSDC += amount;
                executorState.totalEarnedUSDC += amount;
            }

            // 计算今日收益
            if (claim.created_at) {
                const claimDate = new Date(claim.created_at);
                if (claimDate.getTime() >= todayTimestamp) {
                    executorState.todayEarnedUSDC += amount;
                }
            }
        });

        renderEarnSummary();
    } catch (err) {
        console.error("Failed to load earn summary:", err);
    }
}

export function renderEarnSummary() {
    const withdrawable = document.querySelector<HTMLElement>("#withdrawable-amount");
    const total = document.querySelector<HTMLElement>("#total-earned");
    const today = document.querySelector<HTMLElement>("#today-earned");
    const pending = document.querySelector<HTMLElement>("#pending-earned");

    if (withdrawable) withdrawable.textContent = formatUSDC(executorState.withdrawableUSDC);
    if (total) total.textContent = formatUSDC(executorState.totalEarnedUSDC);
    if (today) today.textContent = formatUSDC(executorState.todayEarnedUSDC);
    if (pending) pending.textContent = formatUSDC(executorState.pendingUSDC);
}

export function renderActivityList(claims: EarnClaim[]) {
    const list = document.querySelector<HTMLElement>("#earn-activity-list");
    if (!list) return;
    list.innerHTML = "";

    if (claims.length === 0) {
        list.innerHTML = `<div class="activity-empty">No activity yet.</div>`;
        return;
    }

    claims.forEach((claim) => {
        const item = cloneTemplate("tpl-activity-item");
        $2<HTMLElement>(item, ".activity-title").textContent = claim.ad_title || claim.ad_id;
        $2<HTMLElement>(item, ".activity-status").textContent = claim.status;
        $2<HTMLElement>(item, ".activity-meta").textContent = `Created: ${formatClaimTime(claim.created_at)} · Expires: ${formatClaimTime(claim.expires_at)}`;
        $2<HTMLElement>(item, ".activity-reward").textContent = formatUSDC(atomicToUsdcNumber(claim.unit_price_atomic));
        list.appendChild(item);
    });
}

export function toggleActivityModal(open: boolean) {
    const modal = document.querySelector<HTMLElement>("#earn-activity-modal");
    if (!modal) return;
    modal.classList.toggle("active", open);
}

export function initSummaryActions() {
    document.querySelector<HTMLButtonElement>("#btn-withdraw")?.addEventListener("click", () => {
        if (executorState.withdrawableUSDC <= 0) {
            showNotification("Nothing to withdraw.");
            return;
        }

        const amount = executorState.withdrawableUSDC;
        executorState.withdrawableUSDC = 0;

        renderEarnSummary();
        showNotification(`Withdraw submitted: ${formatUSDC(amount)}`);
    });

    document.querySelector<HTMLButtonElement>("#btn-earn-activity")?.addEventListener("click", () => {
        toggleActivityModal(true);
        loadClaims()
            .then(renderActivityList)
            .catch((err) => {
                console.error("Load claims failed:", err);
                showNotification((err as Error).message || "Failed to load activity.", "error");
            });
    });

    document.querySelector<HTMLButtonElement>("#earn-activity-modal .btn-close")?.addEventListener("click", () => {
        toggleActivityModal(false);
    });

    document.querySelector<HTMLElement>("#earn-activity-modal")?.addEventListener("click", (ev) => {
        if ((ev.target as HTMLElement).id === "earn-activity-modal") {
            toggleActivityModal(false);
        }
    });
}
