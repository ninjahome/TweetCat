import {
    $Id,
    $2,
    atomicToUsdcNumber,
    cloneTemplate,
    formatUSDC,
    multiplyAtomic,
    showNotification,
    usdcToAtomic,
    x402WorkerFetch
} from "./common";
import {ChainNameBaseMain, walletInfo, X402_FACILITATORS} from "../common/x402_obj";
import {getChainId} from "../wallet/wallet_setting";
import {postToX402SrvByPri, queryCdpWalletInfo} from "../wallet/cdp_wallet";
import {logAdP} from "../common/debug_flags";

type AdStatus = "Active" | "Paused" | "Ended" | "Balance Low";

export interface AdAccountInfo {
    balanceAtomic: string;
    frozenAtomic: string;    // frozen
}

interface MyAdRow {
    id: string;
    name: string;
    status: AdStatus;
    rewardPerTask: number;
    completed: number;
    spent: number;
    remainingBudget: number;
}

interface AdRecord {
    ad_id: string;
    a_x_id: string;
    ad_type: string;
    category: string;
    name: string;
    title: string;
    description: string;
    detail_url: string;
    unit_price_atomic: string;
    quota_total: number;
    quota_used: number;
    status: string;
    start_at?: string | null;
    end_at?: string | null;
    created_at: string;
}

interface SpendRecord {
    id: string;
    time: string;
    adName: string;
    event: string;
    amount: number;
    fee: number;
    status: "Success" | "Pending" | "Failed";
}

interface HistoryRow {
    time: string;
    adNameOrMethod: string;
    amount: number;
    status: string;
}

// ========= 数据存储 =========

let adAccountInfo: AdAccountInfo = {balanceAtomic: "0", frozenAtomic: "0"};
let myAds: AdRecord[] = [];
let spendRecords: SpendRecord[] = [];
let historyRecharge: HistoryRow[] = [];
let walletInfoCache: walletInfo | null = null;
let isTransferBusy = false;

// ========= API helpers =========

/**
 * 初始化钱包信息并更新 UI
 * @throws 如果用户未登录
 */
async function initWalletInfo(): Promise<void> {
    const chainId = await getChainId();
    walletInfoCache = await queryCdpWalletInfo(chainId);

    if (!walletInfoCache.hasCreated) {
        throw new Error("Please sign in and create wallet first");
    }

    if (!walletInfoCache.xId) {
        throw new Error("X account not connected. Please sign in with X");
    }

    // 更新头部信息
    updateHeaderInfo();
    // 更新推特头像
    updateTwitterAvatar();
}

/**
 * 更新头部的网络和地址显示
 */
function updateHeaderInfo(): void {
    if (!walletInfoCache) return;

    const networkEl = $Id("header-network");
    const accountEl = $Id("header-account");
    const balanceEl = $Id("balance-value");

    if (networkEl) {
        const cfg = X402_FACILITATORS[walletInfoCache.chainId]
        networkEl.textContent = cfg.network || ChainNameBaseMain;
    }

    if (accountEl && walletInfoCache.address) {
        const addr = walletInfoCache.address;
        accountEl.textContent = `${addr.slice(0, 6)}...${addr.slice(-4)}`;
        accountEl.title = addr;
        accountEl.style.cursor = "pointer";
        accountEl.addEventListener("click", async () => {
            await navigator.clipboard.writeText(addr);
            showNotification("Copy Success", "success");
        });
    }
    if (balanceEl) {
        balanceEl.textContent = walletInfoCache.usdcVal
    }
}


/**
 * 更新推特头像
 */
function updateTwitterAvatar(): void {
    if (!walletInfoCache?.username) return;

    const avatarImg = document.querySelector<HTMLImageElement>("#twitter-avatar");
    const userNameEl = document.querySelector<HTMLElement>("#twitter-user-name");
    if (avatarImg) {
        avatarImg.src = `https://unavatar.io/twitter/${walletInfoCache.username}`;
        avatarImg.onerror = () => {
            avatarImg.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ccircle cx='50' cy='50' r='50' fill='%23e5e7eb'/%3E%3Ctext x='50' y='65' text-anchor='middle' fill='%239ca3af' font-size='40' font-family='sans-serif'%3E👤%3C/text%3E%3C/svg%3E";
        };
    }

    if (userNameEl) {
        userNameEl.textContent = walletInfoCache.username;
    }
}

/**
 * 获取当前用户的 X ID
 */
function getCurrentXId(): string {
    if (!walletInfoCache?.xId) {
        throw new Error("X ID not available");
    }
    return walletInfoCache.xId;
}

async function fetchAdsBalance(aXId: string) {
    const chainId = await getChainId();
    const url = X402_FACILITATORS[chainId].endpoint + "/ads/balance";
    const response = await fetch(`${url}?a_x_id=${encodeURIComponent(aXId)}`);
    if (!response.ok) throw new Error(await response.text());
    return await response.json();
}

async function fetchMyAds(aXId: string): Promise<AdRecord[]> {
    const chainId = await getChainId();
    const url = X402_FACILITATORS[chainId].endpoint + "/ads/my_ads";
    const response = await fetch(`${url}?a_x_id=${encodeURIComponent(aXId)}`);
    if (!response.ok) throw new Error(await response.text());
    return (await response.json()) as AdRecord[];
}

async function createAd(payload: Record<string, any>): Promise<{ ok: boolean; data?: any; error?: any }> {
    const chainId = await getChainId();
    const url = X402_FACILITATORS[chainId].endpoint + "/ads/create";
    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        return {ok: false, error: data};
    }
    return {ok: true, data};
}

async function refreshAdsData() {
    const currentXId = getCurrentXId();
    const [balance, ads] = await Promise.all([
        fetchAdsBalance(currentXId),
        fetchMyAds(currentXId),
    ]);
    adAccountInfo = {
        balanceAtomic: balance?.balance_atomic ?? "0",
        frozenAtomic: balance?.frozen_atomic ?? "0",
    };
    myAds = Array.isArray(ads) ? ads : [];

    logAdP("------>>> balance:", balance, " my ads:", myAds)

    renderHeaderBalance();
    renderAdvertiseDashboard();
    renderMyAdsTable();
    updateBudgetSummaryAndBalance();
}

// ========= 顶部余额 & Advertise 仪表盘 =========
function renderHeaderBalance() {
    const availableEl = $Id("ad-account-balance-value");
    if (availableEl) availableEl.textContent = formatUSDC(atomicToUsdcNumber(adAccountInfo.balanceAtomic));

    const frozenEl = $Id("ad-account-frozen-value");
    if (frozenEl) frozenEl.textContent = formatUSDC(atomicToUsdcNumber(adAccountInfo.frozenAtomic ?? "0"));
}


function renderAdvertiseDashboard() {
    const cards = Array.from(document.querySelectorAll<HTMLElement>("#view-advertise .dashboard-card"));

    const card1Value = cards[0] ? $2<HTMLElement>(cards[0], ".card-value") : null;
    if (card1Value) card1Value.textContent = formatUSDC(atomicToUsdcNumber(adAccountInfo.balanceAtomic));

    const activeCount = myAds.filter((ad) => ad.status === "ACTIVE").length;
    const card2Value = cards[1] ? $2<HTMLElement>(cards[1], ".card-value") : null;
    if (card2Value) card2Value.textContent = activeCount.toString();

    // 计算今日支出：从 myAds 中统计所有已使用的配额
    const todaySpend = myAds.reduce((sum, ad) => {
        const spent = atomicToUsdcNumber(multiplyAtomic(ad.unit_price_atomic, ad.quota_used));
        return sum + spent;
    }, 0);
    const card3Value = cards[2] ? $2<HTMLElement>(cards[2], ".card-value") : null;
    if (card3Value) card3Value.textContent = formatUSDC(todaySpend);

    // 本周支出暂时使用相同的值（需要服务器支持日期过滤）
    const weekSpend = todaySpend;
    const card4Value = cards[3] ? $2<HTMLElement>(cards[3], ".card-value") : null;
    if (card4Value) card4Value.textContent = formatUSDC(weekSpend);
}

// ========= My Ads 表格（模板 clone） =========

function mapStatus(status: string): AdStatus {
    if (status === "ACTIVE") return "Active";
    if (status === "PAUSED") return "Paused";
    return "Ended";
}

function buildMyAdRow(ad: AdRecord): MyAdRow {
    const rewardPerTask = atomicToUsdcNumber(ad.unit_price_atomic);
    const completed = Number.isFinite(ad.quota_used) ? ad.quota_used : 0;
    const quotaTotal = Number.isFinite(ad.quota_total) ? ad.quota_total : 0;

    const spentAtomic = multiplyAtomic(ad.unit_price_atomic, completed);
    const remainingAtomic = multiplyAtomic(ad.unit_price_atomic, Math.max(quotaTotal - completed, 0));

    return {
        id: ad.ad_id,
        name: ad.name,
        status: mapStatus(ad.status),
        rewardPerTask,
        completed,
        spent: atomicToUsdcNumber(spentAtomic),
        remainingBudget: atomicToUsdcNumber(remainingAtomic),
    };
}

function renderMyAdsTable() {
    const tbody = document.querySelector<HTMLTableSectionElement>("#my-ads-tbody");
    if (!tbody) return;

    tbody.replaceChildren();

    if (myAds.length === 0) {
        tbody.appendChild(cloneTemplate("tpl-empty-my-ads-row") as any);
        return;
    }

    myAds.map(buildMyAdRow).forEach((ad) => {
        const tr = cloneTemplate("tpl-my-ad-row") as HTMLTableRowElement;
        tr.dataset.adId = ad.id;

        $2<HTMLElement>(tr, ".td-name").textContent = ad.name;
        $2<HTMLElement>(tr, ".td-status").textContent = ad.status;
        $2<HTMLElement>(tr, ".td-reward").textContent = formatUSDC(ad.rewardPerTask);
        $2<HTMLElement>(tr, ".td-completed").textContent = ad.completed.toString();
        $2<HTMLElement>(tr, ".td-spent").textContent = formatUSDC(ad.spent);
        $2<HTMLElement>(tr, ".td-remaining").textContent = formatUSDC(ad.remainingBudget);

        const btnView = $2<HTMLButtonElement>(tr, ".btn-view");
        const btnToggle = $2<HTMLButtonElement>(tr, ".btn-toggle");

        btnView.addEventListener("click", () => showNotification(`View ad: ${ad.name}`));

        btnToggle.textContent = "N/A";
        btnToggle.disabled = true;

        tbody.appendChild(tr);
    });
}

// ========= Recent Spending 表格（模板 clone） =========

function renderSpendTable() {
    const tbody = document.querySelector<HTMLTableSectionElement>("#spending-tbody");
    if (!tbody) return;

    tbody.replaceChildren();

    if (spendRecords.length === 0) {
        tbody.appendChild(cloneTemplate("tpl-empty-spend-row") as any);
        return;
    }

    spendRecords.forEach((r) => {
        const tr = cloneTemplate("tpl-spend-row") as HTMLTableRowElement;
        tr.dataset.id = r.id;

        $2<HTMLElement>(tr, ".td-time").textContent = r.time;
        $2<HTMLElement>(tr, ".td-ad").textContent = r.adName;
        $2<HTMLElement>(tr, ".td-event").textContent = r.event;
        $2<HTMLElement>(tr, ".td-amount").textContent = formatUSDC(r.amount);
        $2<HTMLElement>(tr, ".td-fee").textContent = formatUSDC(r.fee);
        $2<HTMLElement>(tr, ".td-status").textContent = r.status;

        tbody.appendChild(tr);
    });
}

// ========= 发布广告向导（Wizard） =========

let wizardCurrentStep = 1;
const wizardMaxStep = 4;

function openWizard() {
    wizardCurrentStep = 1;
    updateWizardUI();
    const modal = $Id("publish-wizard-modal");
    if (modal) modal.classList.add("active");
}

function closeWizard() {
    const modal = $Id("publish-wizard-modal");
    if (modal) modal.classList.remove("active");
}

function updateWizardUI() {
    const steps = document.querySelectorAll<HTMLElement>(".wizard-step");
    steps.forEach((stepEl) => {
        const step = Number(stepEl.dataset.step);
        stepEl.classList.toggle("active", step === wizardCurrentStep);
        stepEl.classList.toggle("completed", step < wizardCurrentStep);
    });

    const contents = document.querySelectorAll<HTMLElement>(".wizard-content");
    contents.forEach((c) => {
        const step = Number(c.dataset.step);
        c.classList.toggle("active", step === wizardCurrentStep);
    });

    const prevBtn = $Id("btn-wizard-prev") as HTMLButtonElement | null;
    const nextBtn = $Id("btn-wizard-next") as HTMLButtonElement | null;
    const submitBtn = $Id("btn-wizard-submit") as HTMLButtonElement | null;

    if (prevBtn) prevBtn.style.display = wizardCurrentStep > 1 ? "inline-flex" : "none";
    if (nextBtn && submitBtn) {
        if (wizardCurrentStep < wizardMaxStep) {
            nextBtn.style.display = "inline-flex";
            submitBtn.style.display = "none";
        } else {
            nextBtn.style.display = "none";
            submitBtn.style.display = "inline-flex";
            updateBudgetSummaryAndBalance();
        }
    }
}

function goWizardNext() {
    if (wizardCurrentStep < wizardMaxStep) {
        wizardCurrentStep++;
        updateWizardUI();
    }
}

function goWizardPrev() {
    if (wizardCurrentStep > 1) {
        wizardCurrentStep--;
        updateWizardUI();
    }
}

function updateBudgetSummaryAndBalance() {
    const rewardInput = document.querySelector<HTMLInputElement>("#reward-amount");
    const taskLimitInput = document.querySelector<HTMLInputElement>("#task-limit");

    const reward = rewardInput?.value || "0";
    const tasks = Number(taskLimitInput?.value || "0");

    const unitAtomic = usdcToAtomic(reward);
    const requiredAtomic = unitAtomic && Number.isFinite(tasks) ? multiplyAtomic(unitAtomic, tasks) : "0";
    const requiredUsdc = atomicToUsdcNumber(requiredAtomic);

    const fee = 0;
    const total = requiredUsdc + fee;

    const summaryReward = $Id("summary-reward");
    if (summaryReward) summaryReward.textContent = formatUSDC(Number(reward) || 0);

    const summaryTasks = $Id("summary-tasks");
    if (summaryTasks) summaryTasks.textContent = Number.isFinite(tasks) ? tasks.toString() : "0";

    const summaryFee = $Id("summary-fee");
    if (summaryFee) summaryFee.textContent = formatUSDC(fee);

    const summaryTotal = $Id("summary-total");
    if (summaryTotal) summaryTotal.textContent = formatUSDC(total);

    const currentBalance = $Id("current-balance");
    if (currentBalance) currentBalance.textContent = formatUSDC(atomicToUsdcNumber(adAccountInfo.balanceAtomic));

    const balanceStatus = $Id("balance-status");
    if (balanceStatus) {
        balanceStatus.className = "balance-status";

        if (requiredAtomic && BigInt(requiredAtomic) > 0n && BigInt(adAccountInfo.balanceAtomic) >= BigInt(requiredAtomic)) {
            balanceStatus.classList.add("sufficient");
            balanceStatus.textContent = "Your balance is sufficient to publish this ad.";
        } else if (requiredAtomic && BigInt(requiredAtomic) > 0n && BigInt(adAccountInfo.balanceAtomic) < BigInt(requiredAtomic)) {
            balanceStatus.classList.add("insufficient");
            balanceStatus.textContent = "Insufficient balance. Please recharge before publishing.";
        } else {
            balanceStatus.textContent = "";
        }
    }
}

async function submitWizard() {
    const currentXId = getCurrentXId();

    const nameInput = document.querySelector<HTMLInputElement>("#ad-name");
    const adTypeInput = document.querySelector<HTMLSelectElement>("#ad-type");
    const adCategoryInput = document.querySelector<HTMLSelectElement>("#ad-category");
    const adTitleInput = document.querySelector<HTMLInputElement>("#ad-title");
    const adDescriptionInput = document.querySelector<HTMLTextAreaElement>("#ad-description");
    const adUrlInput = document.querySelector<HTMLInputElement>("#ad-url");
    const rewardInput = document.querySelector<HTMLInputElement>("#reward-amount");
    const taskLimitInput = document.querySelector<HTMLInputElement>("#task-limit");
    const startAtInput = document.querySelector<HTMLInputElement>("#start-time");
    const endAtInput = document.querySelector<HTMLInputElement>("#end-time");
    const taskActionInput = document.querySelector<HTMLSelectElement>("#task-action");

    const name = nameInput?.value?.trim() || "";
    const adType = adTypeInput?.value?.trim() || "";
    const category = adCategoryInput?.value?.trim() || taskActionInput?.value?.trim() || "";
    const title = adTitleInput?.value?.trim() || "";
    const description = adDescriptionInput?.value?.trim() || "";
    const detailUrl = adUrlInput?.value?.trim() || "";

    const reward = rewardInput?.value || "";
    const quotaTotal = Number(taskLimitInput?.value || "0");
    const unitPriceAtomic = usdcToAtomic(reward);

    if (!name || !adType || !category || !title || !description || !detailUrl || !unitPriceAtomic || quotaTotal <= 0) {
        showNotification("Please complete required fields.", "error");
        return;
    }

    const payload = {
        a_x_id: currentXId,
        ad_type: adType,
        category,
        name,
        title,
        description,
        detail_url: detailUrl,
        unit_price_atomic: unitPriceAtomic,
        quota_total: quotaTotal,
        start_at: startAtInput?.value || null,
        end_at: endAtInput?.value || null,
    };

    const result = await createAd(payload);
    if (!result.ok) {
        if (result.error?.error === "INSUFFICIENT_BALANCE") {
            showNotification(`余额不足。需要 ${result.error?.detail || ""}`.trim(), "error");
            return;
        }
        showNotification("Failed to create ad.", "error");
        return;
    }

    showNotification("创建成功", "success");
    closeWizard();
    await refreshAdsData();
}

// ========= Transfer 弹窗（Wallet ⇄ Ads） =========

type TransferDirection = "wallet_to_ads" | "ads_to_wallet";
let transferDirection: TransferDirection = "wallet_to_ads";

function normalizeWalletUsdcDisplay(v: string): string {
    const s = (v ?? "").trim();
    if (!s) return "0.00 USDC";
    return s.toUpperCase().includes("USDC") ? s : `${s} USDC`;
}

function parseUsdcNumber(v: string): number {
    const cleaned = (v ?? "").replace(/[^0-9.]/g, "");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : 0;
}

function setTransferDirection(dir: TransferDirection) {
    transferDirection = dir;

    const btnA = $Id("transfer-dir-wallet-to-ads");
    const btnB = $Id("transfer-dir-ads-to-wallet");
    btnA?.classList.toggle("active", dir === "wallet_to_ads");
    btnB?.classList.toggle("active", dir === "ads_to_wallet");

    const submitBtn = $Id("btn-transfer-submit") as HTMLButtonElement | null;
    if (submitBtn) {
        submitBtn.textContent = dir === "wallet_to_ads" ? "Transfer to Ads" : "Transfer to Wallet";
    }

    const indicator = $Id("transfer-direction-indicator");
    if (indicator) {
        indicator.textContent =
            dir === "wallet_to_ads"
                ? "On-chain Wallet → Ads Account"
                : "Ads Account → On-chain Wallet";
    }
}

function syncTransferModalUI() {
    const walletBal = $Id("transfer-wallet-balance");
    if (walletBal) walletBal.textContent = normalizeWalletUsdcDisplay(walletInfoCache?.usdcVal ?? "0.00");

    const adsAvail = $Id("transfer-ads-available");
    if (adsAvail) adsAvail.textContent = formatUSDC(atomicToUsdcNumber(adAccountInfo.balanceAtomic));

    const adsFrozen = $Id("transfer-ads-frozen");
    if (adsFrozen) adsFrozen.textContent = formatUSDC(atomicToUsdcNumber(adAccountInfo.frozenAtomic ?? "0"));

    const amountInput = $Id("transfer-amount") as HTMLInputElement | null;
    if (amountInput) amountInput.value = "";
}

function openRechargeModal() {
    const modal = $Id("recharge-modal");
    if (modal) modal.classList.add("active");

    syncTransferModalUI();
    setTransferDirection("wallet_to_ads");
    setTransferInlineError(null);
}

function closeRechargeModal() {
    const modal = $Id("recharge-modal");
    if (modal) modal.classList.remove("active");
}

function initRechargeModalEvents() {
    const btnRecharge = $Id("btn-recharge") as HTMLButtonElement | null;
    if (btnRecharge) btnRecharge.addEventListener("click", openRechargeModal);

    const closeRecharge = $Id("close-recharge") as HTMLButtonElement | null;
    if (closeRecharge) closeRecharge.addEventListener("click", closeRechargeModal);

    const dirA = $Id("transfer-dir-wallet-to-ads") as HTMLButtonElement | null;
    if (dirA) dirA.addEventListener("click", () => setTransferDirection("wallet_to_ads"));

    const dirB = $Id("transfer-dir-ads-to-wallet") as HTMLButtonElement | null;
    if (dirB) dirB.addEventListener("click", () => setTransferDirection("ads_to_wallet"));

    const btnMax = $Id("transfer-max") as HTMLButtonElement | null;
    if (btnMax) btnMax.addEventListener("click", () => {
        const input = $Id("transfer-amount") as HTMLInputElement | null;
        if (!input) return;

        const max =
            transferDirection === "wallet_to_ads"
                ? parseUsdcNumber(walletInfoCache?.usdcVal ?? "0")
                : atomicToUsdcNumber(adAccountInfo.balanceAtomic);

        input.value = Math.max(0, max).toFixed(2);
    });

    const btnSubmit = $Id("btn-transfer-submit") as HTMLButtonElement | null;
    if (btnSubmit) {
        // ✅ 不使用 addEventListener：按要求直接赋值 onclick
        btnSubmit.onclick = () => {
            void handleAdsEscrowTransfer();
        };
    }
}

function setTransferBusy(isBusy: boolean, label?: string): void {
    isTransferBusy = isBusy;

    const overlay = $Id("loading-overlay");
    if (overlay) overlay.style.display = isBusy ? "flex" : "none";

    const controls: Array<HTMLInputElement | HTMLButtonElement | null> = [
        $Id("btn-transfer-submit") as HTMLButtonElement | null,
        $Id("transfer-amount") as HTMLInputElement | null,
        $Id("transfer-max") as HTMLButtonElement | null,
        $Id("transfer-dir-wallet-to-ads") as HTMLButtonElement | null,
        $Id("transfer-dir-ads-to-wallet") as HTMLButtonElement | null,
        $Id("close-recharge") as HTMLButtonElement | null,
    ];

    controls.forEach((control) => {
        if (!control) return;
        control.disabled = isBusy;
    });

    const submitBtn = $Id("btn-transfer-submit") as HTMLButtonElement | null;
    if (submitBtn) {
        if (isBusy) {
            submitBtn.dataset.defaultLabel = submitBtn.textContent || "";
            if (label) submitBtn.textContent = label;
        } else if (submitBtn.dataset.defaultLabel) {
            submitBtn.textContent = submitBtn.dataset.defaultLabel;
        }
    }
}

function setTransferInlineError(message: string | null): void {
    const inlineError = $Id("transfer-inline-error");
    if (!inlineError) return;

    if (!message) {
        inlineError.textContent = "";
        inlineError.classList.add("hidden");
        return;
    }

    inlineError.textContent = message;
    inlineError.classList.remove("hidden");
}

function openTxInExplorer(txHash: string): void {
    const networkLabel = ($Id("header-network")?.textContent || "").toLowerCase();
    const isSepolia = networkLabel.includes("sepolia");
    const baseUrl = isSepolia ? "https://sepolia.basescan.org/tx/" : "https://basescan.org/tx/";
    window.open(`${baseUrl}${txHash}`, "_blank");
}

function getErrMsgFromResponse(resp: Response, data: any, fallbackText: string): string {
    const msg =
        data?.detail ||
        data?.message ||
        (typeof data?.error === "string" ? data.error : "") ||
        fallbackText ||
        `HTTP ${resp.status}`;
    return String(msg).trim() || `HTTP ${resp.status}`;
}

async function refreshWalletAndAdsUI(): Promise<void> {
    const chainId = await getChainId();
    walletInfoCache = await queryCdpWalletInfo(chainId);
    updateHeaderInfo();
    await refreshAdsData();
    syncTransferModalUI();
}

/**
 * 处理 Ads 托管账户的充值 / 提现
 * - wallet_to_ads  => POST /ads/publisher/recharge (x402 用户支付)
 * - ads_to_wallet  => POST /ads/publisher/withdraw (服务器金库支付)
 */
async function handleAdsEscrowTransfer(): Promise<void> {
    if (isTransferBusy) return;

    const input = $Id("transfer-amount") as HTMLInputElement | null;
    const amountStr = (input?.value || "").trim();
    const amount = Number(amountStr);

    if (!Number.isFinite(amount) || amount <= 0) {
        showNotification("Please enter a valid amount.", "error");
        return;
    }

    // Ads → Wallet：不能超过 Ads Available
    if (transferDirection === "ads_to_wallet") {
        const maxAds = atomicToUsdcNumber(adAccountInfo.balanceAtomic);
        if (amount > maxAds + 1e-9) {
            showNotification("Amount exceeds Ads Available.", "error");
            return;
        }
    }

    // Wallet → Ads：不能超过 Wallet USDC
    if (transferDirection === "wallet_to_ads") {
        const maxWallet = parseUsdcNumber(walletInfoCache?.usdcVal ?? "0");
        if (amount > maxWallet + 1e-9) {
            showNotification("Amount exceeds Wallet USDC.", "error");
            return;
        }
    }

    // 历史记录：先写 Pending
    const directionLabel = transferDirection === "wallet_to_ads" ? "Wallet → Ads" : "Ads → Wallet";
    const historyItem: HistoryRow = {
        time: new Date().toLocaleString(),
        adNameOrMethod: directionLabel,
        amount,
        status: "Pending",
    };
    historyRecharge.unshift(historyItem);
    switchHistoryTab("recharge");

    const chainId = await getChainId();
    const base = X402_FACILITATORS[chainId].endpoint;
    const path = transferDirection === "wallet_to_ads" ? "/ads/publisher/recharge" : "/ads/publisher/withdraw";
    const endpoint = `${base}${path}`;

    const payload = {
        a_x_id: getCurrentXId(),
        amount: amountStr, // 服务器端会 usdcToAtomicSafe
    };

    setTransferInlineError(null);
    setTransferBusy(true, "Processing...");

    try {
        let resp: Response;

        if (transferDirection === "wallet_to_ads") {
            // ✅ 充值：x402 用户侧支付（需要签名/支付 402 challenge）
            resp = await postToX402SrvByPri(endpoint, payload);
        } else {
            // ✅ 提现：服务器金库侧支付（普通 POST 即可）
            resp = await x402WorkerFetch(endpoint, payload);
        }

        const text = await resp.text();
        let data: any;
        try {
            data = text ? JSON.parse(text) : {};
        } catch {
            data = {};
        }

        if (!resp.ok || data?.success !== true) {
            historyItem.status = "Failed";
            switchHistoryTab("recharge");
            setTransferInlineError(getErrMsgFromResponse(resp, data, text));
            return;
        }

        // 成功：更新历史 + 打开浏览器
        const txHash = data?.txHash || data?.tx_hash || data?.transaction || data?.transactionHash;
        if (!txHash) {
            historyItem.status = "Failed";
            switchHistoryTab("recharge");
            setTransferInlineError("Transfer succeeded but no transaction hash was returned.");
            return;
        }

        historyItem.status = "Success";
        switchHistoryTab("recharge");

        const msg =
            (typeof data?.message === "string" && data.message.trim())
                ? data.message
                : "Transfer submitted.";
        showNotification(msg, "success");

        if (txHash) {
            openTxInExplorer(String(txHash));
        }

        closeRechargeModal();
        await refreshWalletAndAdsUI();
    } catch (e: any) {
        historyItem.status = "Failed";
        switchHistoryTab("recharge");
        setTransferInlineError(e?.message || "Transfer failed");
    } finally {
        setTransferBusy(false);
    }
}


// ========= 历史记录弹窗（模板 clone） =========

function openHistoryModal(defaultTab: "earnings" | "spending" | "recharge" = "spending") {
    const modal = $Id("history-modal");
    if (modal) modal.classList.add("active");
    switchHistoryTab(defaultTab);
}

function closeHistoryModal() {
    const modal = $Id("history-modal");
    if (modal) modal.classList.remove("active");
}

function renderHistoryTable(tab: "earnings" | "spending" | "recharge", rows: HistoryRow[]) {
    // 现在仅镜不查看 charging 记录
    if (tab !== "recharge") return;

    const tbody = document.querySelector<HTMLTableSectionElement>("#recharge-history-tbody");
    if (!tbody) return;

    tbody.replaceChildren();

    if (rows.length === 0) {
        const tr = cloneTemplate("tpl-empty-history-row") as HTMLTableRowElement;
        $2<HTMLElement>(tr, ".td-empty").textContent = "No transfer records yet";
        tbody.appendChild(tr);
        return;
    }

    rows.forEach((row) => {
        const tr = cloneTemplate("tpl-history-row") as HTMLTableRowElement;
        $2<HTMLElement>(tr, ".td-time").textContent = row.time;
        $2<HTMLElement>(tr, ".td-name").textContent = row.adNameOrMethod;
        $2<HTMLElement>(tr, ".td-amount").textContent = formatUSDC(row.amount);
        $2<HTMLElement>(tr, ".td-status").textContent = row.status;
        tbody.appendChild(tr);
    });
}

function switchHistoryTab(tab: "earnings" | "spending" | "recharge") {
    // 现在仅仅显示 recharge 欄位
    if (tab === "recharge") renderHistoryTable("recharge", historyRecharge);
}

function initHistoryModalEvents() {
    const btnHistory = $Id("btn-history") as HTMLButtonElement | null;
    if (btnHistory) btnHistory.addEventListener("click", () => openHistoryModal("recharge"));

    const closeHistory = $Id("close-history") as HTMLButtonElement | null;
    if (closeHistory) closeHistory.addEventListener("click", closeHistoryModal);
}

// ========= 事件绑定：Wizard =========
function initNavEvents() {
    const btnBack = $Id("btn-back-plaza") as HTMLButtonElement | null;
    if (btnBack) btnBack.addEventListener("click", () => {
        window.location.href = "ad_plaza.html";
    });
}

function initSpendTabs() {
    const group = document.querySelector<HTMLElement>('.dashboard-group[data-group="spend"]');
    if (!group) return;

    const tabs = Array.from(group.querySelectorAll<HTMLButtonElement>(".dashboard-tab"));
    const cards = Array.from(group.querySelectorAll<HTMLElement>('.dashboard-card[data-range]'));

    if (tabs.length === 0 || cards.length === 0) return;

    const setRange = (range: string) => {
        tabs.forEach((t) => t.classList.toggle("active", (t.dataset.range || "") === range));
        cards.forEach((c) => c.classList.toggle("is-hidden", (c.dataset.range || "") !== range));
    };

    // 初始状态：以 DOM 上默认 active tab 为准，否则用第一个
    const defaultRange =
        tabs.find((t) => t.classList.contains("active"))?.dataset.range ||
        tabs[0].dataset.range ||
        "today";

    setRange(defaultRange);

    tabs.forEach((t) => {
        t.addEventListener("click", () => setRange(t.dataset.range || "today"));
    });
}

function initWizardEvents() {
    const btnPublish = $Id("btn-publish-ad") as HTMLButtonElement | null;
    if (btnPublish) btnPublish.addEventListener("click", openWizard);

    const closeWizardBtn = $Id("close-wizard") as HTMLButtonElement | null;
    if (closeWizardBtn) closeWizardBtn.addEventListener("click", closeWizard);

    const btnPrev = $Id("btn-wizard-prev") as HTMLButtonElement | null;
    if (btnPrev) btnPrev.addEventListener("click", goWizardPrev);

    const btnNext = $Id("btn-wizard-next") as HTMLButtonElement | null;
    if (btnNext) btnNext.addEventListener("click", goWizardNext);

    const btnSubmit = $Id("btn-wizard-submit") as HTMLButtonElement | null;
    if (btnSubmit) btnSubmit.addEventListener("click", submitWizard);

    const rewardAmount = document.querySelector<HTMLInputElement>("#reward-amount");
    if (rewardAmount) rewardAmount.addEventListener("input", updateBudgetSummaryAndBalance);

    const taskLimit = document.querySelector<HTMLInputElement>("#task-limit");
    if (taskLimit) taskLimit.addEventListener("input", updateBudgetSummaryAndBalance);
}

// ========= 初始化入口 =========

async function initAdvertise() {
    renderHeaderBalance();
    renderAdvertiseDashboard();
    renderMyAdsTable();
    renderSpendTable();

    initNavEvents();
    initSpendTabs();

    initWizardEvents();
    initRechargeModalEvents();
    initHistoryModalEvents();

    try {
        await initWalletInfo();
        logAdP("------>>> wallet info:", walletInfoCache);
        await refreshAdsData();
    } catch (err) {
        console.error("Failed to initialize wallet info:", err);
        showNotification((err as Error).message || "Please sign in first.", "error");
    }
}

document.addEventListener("DOMContentLoaded", () => {
    initAdvertise().catch((err) => {
        console.error("Advertise init error:", err);
    });
});
