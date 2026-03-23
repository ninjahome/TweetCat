import { $2, atomicToUsdcNumber, cloneTemplate, formatUSDC, formatUSDCTrimmed, getCurrentUserInfo, showNotification } from "../common";
import { t } from "../../common/i18n";
import { X402_FACILITATORS } from "../../common/x402_obj";
import {
    adsWorkerFetch,
    adsWorkerGet,
    API_PATH_ADS_MY_CLAIMS,
    API_PATH_ADS_EXECUTOR_WITHDRAW,
    API_PATH_ADS_EXECUTOR_DASHBOARD_INFO,
    getAdsChainId,
    openTxInExplorer
} from "./ad_publisher_common";
import { EarnClaim, executorState, formatClaimTime, TASK_STATUS_MAP } from "./ad_executor_common";

export async function loadClaims(): Promise<EarnClaim[]> {
    const { xId } = await getCurrentUserInfo();
    const response = await adsWorkerGet(API_PATH_ADS_MY_CLAIMS, { b_x_id: xId });
    return Array.isArray(response) ? (response as EarnClaim[]) : [];
}

export async function loadEarnSummary(): Promise<void> {
    try {
        const { xId } = await getCurrentUserInfo();

        // 1. 并行加载统计数据和流水记录
        const [statsResp, claims] = await Promise.all([
            adsWorkerGet(API_PATH_ADS_EXECUTOR_DASHBOARD_INFO, { b_x_id: xId }),
            loadClaims()
        ]);

        // 2. 更新状态
        executorState.myClaims = claims;

        if (statsResp.success && statsResp.data) {
            const stats = statsResp.data;
            executorState.withdrawableAtomic = String(stats.withdrawable_atomic || "0");
            executorState.withdrawableUSDC = atomicToUsdcNumber(stats.withdrawable_atomic);
            executorState.pendingUSDC = atomicToUsdcNumber(stats.pending_atomic);
            executorState.todayEarnedUSDC = atomicToUsdcNumber(stats.today_earned_atomic);
            executorState.totalEarnedUSDC = atomicToUsdcNumber(stats.total_earned_atomic);
            executorState.lastWithdrawAt = stats.last_withdraw_at || null;

            // Set network name for explorer links
            const chainId = await getAdsChainId();
            const networkEl = document.getElementById("header-network");
            if (networkEl) {
                const config = X402_FACILITATORS[chainId];
                networkEl.textContent = config?.network || "";
            }
        }

        renderEarnSummary();
    } catch (err) {
        console.error("Failed to load earn summary:", err);
        showNotification((err as Error)?.message || t("operation_failed"), "error");
    }
}

function getWeeklyWindowInfo(date: Date): { key: string; nextStart: Date } | null {
    const time = date.getTime();
    if (!Number.isFinite(time)) return null;

    const year = date.getUTCFullYear();
    const startOfYearMs = Date.UTC(year, 0, 1);
    const diffDays = Math.floor((time - startOfYearMs) / 86400000);
    const weekNum = Math.floor(diffDays / 7) + 1;

    return {
        key: `${year}-W${weekNum}`,
        nextStart: new Date(startOfYearMs + weekNum * 7 * 86400000)
    };
}

function getWithdrawLimitState(now: Date = new Date()) {
    const lastWithdrawAt = executorState.lastWithdrawAt;
    if (!lastWithdrawAt) {
        return {
            limited: false,
            lastWithdrawDate: null,
            nextAvailableDate: null
        };
    }

    const lastWithdrawDate = new Date(lastWithdrawAt);
    const nowWindow = getWeeklyWindowInfo(now);
    const lastWindow = getWeeklyWindowInfo(lastWithdrawDate);

    if (!nowWindow || !lastWindow || nowWindow.key !== lastWindow.key) {
        return {
            limited: false,
            lastWithdrawDate,
            nextAvailableDate: null
        };
    }

    return {
        limited: true,
        lastWithdrawDate,
        nextAvailableDate: nowWindow.nextStart
    };
}

function renderWithdrawLimitState() {
    const weeklyWarning = document.getElementById("weekly-limit-warning");
    const limitDetails = document.getElementById("weekly-limit-details");
    const prevDateEl = document.getElementById("weekly-previous-withdraw-date");
    const nextDateEl = document.getElementById("weekly-next-available-date");
    const submitBtn = document.querySelector<HTMLButtonElement>("#btn-withdraw");
    const { limited, lastWithdrawDate, nextAvailableDate } = getWithdrawLimitState();

    if (weeklyWarning) {
        weeklyWarning.classList.toggle("hidden", !limited);
    }

    if (limitDetails) {
        limitDetails.classList.toggle("hidden", !limited);
    }

    if (prevDateEl) {
        prevDateEl.textContent = lastWithdrawDate ? lastWithdrawDate.toLocaleString() : "--";
    }

    if (nextDateEl) {
        nextDateEl.textContent = nextAvailableDate ? nextAvailableDate.toLocaleString() : "--";
    }

    if (submitBtn) {
        submitBtn.disabled = limited;
        submitBtn.title = limited ? t("weekly_limit_reached_title") : "";
    }
}

export function renderEarnSummary() {
    const withdrawable = document.querySelector<HTMLElement>("#withdrawable-amount");
    const total = document.querySelector<HTMLElement>("#total-earned");
    const today = document.querySelector<HTMLElement>("#today-earned");
    const pending = document.querySelector<HTMLElement>("#pending-earned");

    if (withdrawable) {
        const amountEl = withdrawable.querySelector(".card-value-amount");
        if (amountEl) {
            amountEl.textContent = formatUSDC(executorState.withdrawableUSDC, false);
        } else {
            withdrawable.textContent = formatUSDC(executorState.withdrawableUSDC);
        }
    }
    if (total) total.textContent = formatUSDC(executorState.totalEarnedUSDC, false);
    if (today) today.textContent = formatUSDC(executorState.todayEarnedUSDC, false);
    if (pending) pending.textContent = formatUSDC(executorState.pendingUSDC, false);
    renderWithdrawLimitState();
}

export function renderActivityList(claims: EarnClaim[]) {
    const list = document.querySelector<HTMLElement>("#earn-activity-list");
    if (!list) return;
    list.innerHTML = "";

    if (claims.length === 0) {
        list.innerHTML = `<div class="activity-empty">${t("no_activity_yet")}</div>`;
        return;
    }

    claims.forEach((claim) => {
        const item = cloneTemplate("tpl-activity-item");
        $2<HTMLElement>(item, ".activity-title").textContent = claim.ad_title || claim.ad_id;
        $2<HTMLElement>(item, ".activity-status").textContent = TASK_STATUS_MAP[claim.status || ""] || claim.status;
        $2<HTMLElement>(item, ".activity-meta").textContent = `${t("activity_created")}: ${formatClaimTime(claim.created_at)} · ${t("activity_expires")}: ${formatClaimTime(claim.expires_at)}`;
        $2<HTMLElement>(item, ".activity-reward").textContent = formatUSDCTrimmed(atomicToUsdcNumber(claim.unit_price_atomic));
        list.appendChild(item);
    });
}

export function toggleActivityModal(open: boolean) {
    const modal = document.querySelector<HTMLElement>("#earn-activity-modal");
    if (!modal) return;
    modal.classList.toggle("active", open);
}

export function toggleWithdrawSuccessModal(open: boolean, txHash: string = "") {
    const modal = document.querySelector<HTMLElement>("#withdraw-success-modal");
    if (!modal) return;
    modal.classList.toggle("active", open);

    if (open && txHash) {
        const btnView = document.getElementById("btn-withdraw-success-view");
        if (btnView) {
            // Remove previous listeners (if any) by replacing the element or using a flag
            // For simplicity in this context, we'll just set the click handler
            btnView.onclick = () => {
                openTxInExplorer(txHash);
            };
        }
    }
}

export function initSummaryActions() {
    document.querySelector<HTMLButtonElement>("#btn-withdraw")?.addEventListener("click", async () => {
        if (executorState.withdrawableUSDC <= 0) {
            showNotification(t("nothing_to_withdraw"));
            return;
        }

        const btn = document.querySelector<HTMLButtonElement>("#btn-withdraw");
        if (btn) btn.disabled = true;

        try {
            const { xId } = await getCurrentUserInfo();

            // Use the server-side available_atomic (from ad_escrow_accounts) as the real withdrawable amount
            // This is more accurate than recalculating from local claims which could be stale
            const amountAtomic = executorState.withdrawableAtomic || "0";
            if (!amountAtomic || BigInt(amountAtomic) <= 0n) {
                showNotification(t("nothing_to_withdraw"));
                return;
            }

            const amountUSDC = executorState.withdrawableUSDC;
            showNotification(t("withdrawing"), "info");

            // Call Backend (Executor uses their specific withdraw API)
            const resp = await adsWorkerFetch(API_PATH_ADS_EXECUTOR_WITHDRAW, {
                b_x_id: xId,
                amount_atomic: amountAtomic
            });

            if (resp && resp.success) {
                // Success
                executorState.withdrawableUSDC = 0;
                executorState.withdrawableAtomic = "0";
                executorState.lastWithdrawAt = new Date().toISOString();
                renderEarnSummary();

                // Show success modal instead of simple notification
                toggleWithdrawSuccessModal(true, resp.txHash || "");

                // Reload claims/summary to ensure state consistency
                setTimeout(() => loadEarnSummary(), 2000);
            } else if (resp && resp.alreadyWithdrawn) {
                showNotification(resp.message || t("already_withdrawn_this_week"), "info");
            } else {
                // Failed
                const msg = resp?.error || resp?.message || t("withdraw_failed");
                showNotification(msg, "error");
            }

        } catch (e: any) {
            console.error("Withdraw failed:", e);
            showNotification(e.message || t("withdraw_error"), "error");
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
                showNotification((err as Error).message || t("failed_to_load_activity"), "error");
            });
    });

    document.querySelector<HTMLButtonElement>("#earn-activity-modal .btn-close")?.addEventListener("click", () => {
        toggleActivityModal(false);
    });

    document.getElementById("btn-withdraw-success-ok")?.addEventListener("click", () => {
        toggleWithdrawSuccessModal(false);
    });

    document.querySelector<HTMLElement>("#withdraw-success-modal")?.addEventListener("click", (ev) => {
        if ((ev.target as HTMLElement).id === "withdraw-success-modal") {
            toggleWithdrawSuccessModal(false);
        }
    });

    document.querySelector<HTMLElement>("#earn-activity-modal")?.addEventListener("click", (ev) => {
        if ((ev.target as HTMLElement).id === "earn-activity-modal") {
            toggleActivityModal(false);
        }
    });
}
