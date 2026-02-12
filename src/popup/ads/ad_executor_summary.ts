import { $2, atomicToUsdcNumber, cloneTemplate, formatUSDC, getCurrentUserInfo, showNotification } from "../common";
import { x402WorkerGet, x402WorkerFetch } from "../../wallet/cdp_wallet";
import { API_PATH_ADS_MY_CLAIMS, API_PATH_ADS_PUBLISHER_WITHDRAW, API_PATH_ADS_EXECUTOR_DASHBOARD_INFO } from "./ad_publisher_common";
import { EarnClaim, executorState, formatClaimTime } from "./ad_executor_common";

export async function loadClaims(): Promise<EarnClaim[]> {
    const { xId } = await getCurrentUserInfo();
    const response = await x402WorkerGet(API_PATH_ADS_MY_CLAIMS, { b_x_id: xId });
    return Array.isArray(response) ? (response as EarnClaim[]) : [];
}

export async function loadEarnSummary(): Promise<void> {
    try {
        const { xId } = await getCurrentUserInfo();

        // 1. 并行加载统计数据和流水记录
        const [statsResp, claims] = await Promise.all([
            x402WorkerGet(API_PATH_ADS_EXECUTOR_DASHBOARD_INFO, { b_x_id: xId }),
            loadClaims()
        ]);

        // 2. 更新状态
        executorState.myClaims = claims;

        if (statsResp.success && statsResp.data) {
            const stats = statsResp.data;
            executorState.withdrawableUSDC = atomicToUsdcNumber(stats.withdrawable_atomic);
            executorState.pendingUSDC = atomicToUsdcNumber(stats.pending_atomic);
            executorState.todayEarnedUSDC = atomicToUsdcNumber(stats.today_earned_atomic);
            executorState.totalEarnedUSDC = atomicToUsdcNumber(stats.total_earned_atomic);
        }

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
    document.querySelector<HTMLButtonElement>("#btn-withdraw")?.addEventListener("click", async () => {
        if (executorState.withdrawableUSDC <= 0) {
            showNotification("Nothing to withdraw.");
            return;
        }

        const btn = document.querySelector<HTMLButtonElement>("#btn-withdraw");
        if (btn) btn.disabled = true;

        try {
            const { xId } = await getCurrentUserInfo();
            // Convert current USDC balance back to atomic units (USDC has 6 decimals)
            // Or better, we should store atomic balance in state.
            // But since loadEarnSummary calculates from claims (which are strings of atomic),
            // let's re-calculate precise atomic amount or just use what we have.
            // Actually, `withdrawableUSDC` is a number, converting back might have precision issues?
            // Let's re-sum from claims to be safe.

            let totalAtomic = 0n;
            executorState.myClaims.forEach(c => {
                if (c.status === "CONFIRMED") {
                    totalAtomic += BigInt(c.unit_price_atomic);
                }
            });

            if (totalAtomic <= 0n) {
                showNotification("Nothing to withdraw (atomic check).");
                return;
            }

            const amountAtomic = totalAtomic.toString();
            const amountUSDC = executorState.withdrawableUSDC;

            showNotification("Withdrawing...", "info");

            // Call Backend
            const resp = await x402WorkerFetch(API_PATH_ADS_PUBLISHER_WITHDRAW, {
                a_x_id: xId, // Executor withdraws from their own escrow balance
                amount_atomic: amountAtomic
            });

            if (resp && (resp.success || resp.txHash)) {
                // Success
                executorState.withdrawableUSDC = 0;
                renderEarnSummary();

                const txLink = resp.txHash ? ` Tx: ${resp.txHash.slice(0, 6)}...` : "";
                showNotification(`Withdraw success! ${formatUSDC(amountUSDC)}${txLink}`, "success");

                // Reload claims/summary to ensure state consistency
                setTimeout(() => loadEarnSummary(), 2000);
            } else {
                // Failed
                const msg = resp?.error || resp?.message || "Withdraw failed";
                showNotification(msg, "error");
            }

        } catch (e: any) {
            console.error("Withdraw failed:", e);
            showNotification(e.message || "Withdraw error", "error");
        } finally {
            if (btn) btn.disabled = false;
        }
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
