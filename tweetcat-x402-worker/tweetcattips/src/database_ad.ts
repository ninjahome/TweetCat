import type {D1Database} from "@cloudflare/workers-types";

// ========= 类型定义 =========

export type AdCategory = "follow" | "visit" | "register" | "share";

export type AdCampaignStatus = 'ACTIVE' | 'PAUSED_NO_BUDGET' | 'PAUSED_MANUAL' | 'EXPIRED' | 'COMPLETED';

export interface AdAccountInfo {
	balanceAtomic: string;
}

export const CATEGORY_DURATION: Record<AdCategory, number> = {
	follow: 2,
	visit: 3,
	register: 5,
	share: 4,
};

export const CATEGORY_TAGS: Record<AdCategory, string[]> = {
	follow: ["New", "Easy"],
	visit: ["Explore"],
	register: ["High Reward"],
	share: ["Popular"],
};

export interface AdEscrowAccountRow {
	a_x_id: string;
	asset_symbol: string;
	available_atomic: string;
	frozen_atomic: string;
}

export interface AdRow {
	ad_id: string;
	a_x_id: string;
	category: string;
	name: string;
	title: string;
	description: string;
	detail_url: string;
	image_url?: string | null;
	callback_url?: string | null;
	custom_data?: string | null;
	unit_price_atomic: string;
	quota_total: number;
	quota_used: number;
	status: AdCampaignStatus;
	end_date: string; // Changed from duration_days
	created_at?: string | null;
	updated_at?: string | null;
}

export interface AdCreatePayload {
	adId: string;
	aXId: string;
	category: string;
	name: string;
	title: string;
	description: string;
	detailUrl: string;
	imageUrl?: string | null;
	callbackUrl?: string | null;
	customData?: string | null;
	unitPriceAtomic: string;
	quotaTotal: number;
	endDate: string; // Changed from durationDays
}

export interface AdEscrowLedgerRow {
	id?: number;
	ledger_id: string;
	a_x_id: string;
	direction: 'DEPOSIT' | 'WITHDRAW';
	asset_symbol: string;
	amount_atomic: string;
	payer_address?: string | null;
	receiver_address?: string | null;
	tx_hash?: string | null;
	status: 'PENDING' | 'SETTLED' | 'FAILED';
	request_id?: string | null;
	memo?: string | null;
	error_reason?: string | null;
	created_at?: string;
	updated_at?: string;
}

// New types for ad_reward_claims
export type ClaimStatus =
	'CLAIMED'           // 用户已点击领取，初始状态
	| 'PENDING_CONFIRM'   // 等待验证（如 Oracle 验证关注/转发）
	| 'CONFIRMED'         // 验证通过，等待打款
	| 'REJECTED'          // 验证失败或被拒绝
	| 'SETTLED_TIMEOUT';  // 超时未处理，自动结算或关闭

export interface AdRewardClaimRecord {
	claim_id: string;
	ad_id: string;
	b_x_id: string;
	status: ClaimStatus;
	signature: string;
	created_at: string;
	updated_at: string;
	ad_title?: string;
}

export interface CreateDetailedClaimParams {
	claimId: string;
	adId: string;
	bXId: string;
	signature: string;
}

// ========= 辅助函数 =========

export function toSqliteDate(date: Date): string {
	return date.toISOString().replace("T", " ").replace("Z", "");
}

export function formatDeadlineText(endDateStr?: string | null): string {
	if (!endDateStr) return "Ends: -";

	try {
		const endDate = new Date(endDateStr);
		const now = new Date();

		if (endDate < now) {
			return "Ended";
		}

		const dateText = endDate.toISOString().slice(0, 10);
		return `Ends: ${dateText}`;
	} catch {
		return "Ends: -";
	}
}

export function getRewardRange(rewardUSDC: number): "0.1-0.5" | "0.5-1" | "1+" {
	if (rewardUSDC < 0.5) return "0.1-0.5";
	if (rewardUSDC < 1) return "0.5-1";
	return "1+";
}

export function computePopularityScore(completed: number, total: number): number {
	if (total <= 0) return 10;
	const ratio = completed / total;
	return Math.max(10, Math.min(100, Math.round(20 + ratio * 80)));
}

// ========= 广告账户操作 =========

/**
 * 获取广告托管账户信息（包含可用和冻结余额）
 * @param db - D1 数据库实例
 * @param aXId - 广告主 X ID
 * @returns 账户信息或 null
 */
export async function getAdAccountBalance(db: D1Database, aXId: string): Promise<AdEscrowAccountRow | null> {
	const stmt = db.prepare(
		"SELECT a_x_id, asset_symbol, available_atomic, frozen_atomic FROM ad_escrow_accounts WHERE a_x_id = ? AND asset_symbol = 'USDC'"
	).bind(aXId);
	return await stmt.first<AdEscrowAccountRow>();
}

/**
 * 预留广告预算（将可用余额移至冻结余额）
 * 仅当可用余额足够时执行
 * @param db - D1 数据库实例
 * @param aXId - 广告主 X ID
 * @param amountAtomic - 要预留的金额（原子单位）
 * @returns 操作是否成功
 */
export async function reserveAdBudget(db: D1Database, aXId: string, amountAtomic: string): Promise<boolean> {
	const updateSql = `
		UPDATE ad_escrow_accounts
		SET available_atomic = CAST(available_atomic AS INTEGER) - ?,
			frozen_atomic = CAST(frozen_atomic AS INTEGER) + ?,
			updated_at = datetime('now')
		WHERE a_x_id = ?
		  AND asset_symbol = 'USDC'
		  AND CAST(available_atomic AS INTEGER) >= ?
	`;
	const updateResult = await db.prepare(updateSql)
		.bind(amountAtomic, amountAtomic, aXId, amountAtomic)
		.run();

	return updateResult.success && (updateResult.meta.changes ?? 0) > 0;
}

/**
 * 获取账户信息（仅返回可用余额）
 * @param db - D1 数据库实例
 * @param aXId - 广告主 X ID
 * @returns 账户信息结构体
 */
export async function getAccountBalanceAtomic(db: D1Database, aXId: string): Promise<AdAccountInfo> {
	const balanceRow = await db.prepare(
		"SELECT available_atomic FROM ad_escrow_accounts WHERE a_x_id = ? AND asset_symbol = 'USDC'"
	).bind(aXId).first<{available_atomic: string}>();
	return {
		balanceAtomic: balanceRow?.available_atomic ?? "0"
	};
}

// ========= 广告操作 =========

/**
 * 创建新广告
 * @param db - D1 数据库实例
 * @param payload - 广告创建数据
 * @returns 创建是否成功
 */
export async function createAd(db: D1Database, payload: AdCreatePayload): Promise<boolean> {
	const insertSql = `
		INSERT INTO ad_campaigns (
			ad_id, a_x_id, category, name, title, description, detail_url, image_url,
			callback_url, custom_data, unit_price_atomic, quota_total, end_date, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
	`;
	const result = await db.prepare(insertSql)
		.bind(
			payload.adId,
			payload.aXId,
			payload.category,
			payload.name,
			payload.title,
			payload.description,
			payload.detailUrl,
			payload.imageUrl ?? null,
			payload.callbackUrl ?? null,
			payload.customData ?? null,
			payload.unitPriceAtomic,
			payload.quotaTotal,
			payload.endDate
		)
		.run();

	return result.success;
}

/**
 * 更新广告设置（仅限 callback_url 和 custom_data）
 * @param db - D1 数据库实例
 * @param adId - 广告 ID
 * @param aXId - 广告主 X ID (用于权限验证)
 * @param callbackUrl - 回调 URL (可选)
 * @param customData - 自定义数据 (可选)
 * @returns 更新是否成功
 */
export async function updateAdSettings(
	db: D1Database,
	adId: string,
	aXId: string,
	callbackUrl: string | null,
	customData: string | null
): Promise<boolean> {
	const updateSql = `
		UPDATE ad_campaigns
		SET callback_url = ?,
			custom_data = ?,
			updated_at = datetime('now')
		WHERE ad_id = ? AND a_x_id = ?
	`;
	const result = await db.prepare(updateSql)
		.bind(callbackUrl, customData, adId, aXId)
		.run();

	return result.success && (result.meta.changes ?? 0) > 0;
}

/**
 * 更新广告状态
 * @param db - D1 数据库实例
 * @param adId - 广告 ID
 * @param newStatus - 新的广告状态
 * @returns 更新是否成功
 */
export async function updateAdStatus(
	db: D1Database,
	adId: string,
	newStatus: AdCampaignStatus
): Promise<boolean> {
	const updateSql = `
		UPDATE ad_campaigns
		SET status = ?,
			updated_at = datetime('now')
		WHERE ad_id = ?
	`;
	const result = await db.prepare(updateSql)
		.bind(newStatus, adId)
		.run();

	return result.success && (result.meta.changes ?? 0) > 0;
}

/**
 * 获取用户的所有广告
 * @param db - D1 数据库实例
 * @param aXId - 广告主 X ID
 * @returns 广告列表
 */
export async function getMyAds(db: D1Database, aXId: string): Promise<AdRow[]> {
	const stmt = db.prepare(
		"SELECT * FROM ad_campaigns WHERE a_x_id = ? ORDER BY created_at DESC LIMIT 200"
	).bind(aXId);
	const result = await stmt.all<AdRow>();
	return result.results ?? [];
}

/**
 * 获取所有活跃广告列表（用于用户浏览）
 * @param db - D1 数据库实例
 * @returns 活跃广告列表
 */
export async function getActiveAdsList(db: D1Database): Promise<AdRow[]> {
	const sql = `
		SELECT
			c.ad_id, c.title, c.a_x_id, c.description, c.category, c.unit_price_atomic,
			c.quota_used, c.quota_total, c.end_date, c.created_at, c.detail_url
		FROM
			ad_campaigns c
		JOIN
			ad_escrow_accounts e ON c.a_x_id = e.a_x_id
		WHERE
			c.status = 'ACTIVE'
			AND c.end_date > datetime('now')
			AND c.quota_used < c.quota_total
			AND CAST(e.frozen_atomic AS INTEGER) >= CAST(c.unit_price_atomic AS INTEGER)
		ORDER BY
			c.created_at DESC
		LIMIT 100
	`;
	const result = await db.prepare(sql).all<AdRow>();
	return result.results ?? [];
}

/**
 * 根据 ID 获取单个广告
 * @param db - D1 数据库实例
 * @param adId - 广告 ID
 * @returns 广告信息或 null
 */
export async function getAdById(db: D1Database, adId: string): Promise<AdRow | null> {
	const adRow = await db.prepare(
		`SELECT ad_id, a_x_id, unit_price_atomic, status, quota_used, quota_total,
		        category, name, title, description, detail_url, callback_url, custom_data,
		        end_date, created_at, updated_at
		 FROM ad_campaigns
		 WHERE ad_id = ?`
	).bind(adId).first<AdRow>();

	return adRow ?? null;
}

/**
 * 增加广告的使用配额（领取任务时调用）
 * @param db - D1 数据库实例
 * @param adId - 广告 ID
 * @returns 操作是否成功
 */
export async function incrementAdQuota(db: D1Database, adId: string): Promise<boolean> {
	const updateResult = await db.prepare(
		`UPDATE ad_campaigns
		 SET quota_used = quota_used + 1,
		     updated_at = datetime('now')
		 WHERE ad_id = ? AND status = 'ACTIVE' AND quota_used < quota_total`
	).bind(adId).run();

	return updateResult.success && (updateResult.meta.changes ?? 0) > 0;
}

// ========= 新的领取记录操作 (ad_reward_claims) =========

/**
 * 创建新的详细领取记录 (带签名)
 */
export async function createDetailedClaim(db: D1Database, params: CreateDetailedClaimParams): Promise<boolean> {
	const sql = `
		INSERT INTO ad_reward_claims (
			claim_id, ad_id, b_x_id, status, signature
		) VALUES (?, ?, ?, 'CLAIMED', ?)
	`;

	try {
		const result = await db.prepare(sql).bind(
			params.claimId,
			params.adId,
			params.bXId,
			params.signature
		).run();

		return result.success;
	} catch (e) {
		console.error("Failed to create detailed claim:", e);
		return false;
	}
}

/**
 * 检查是否已领取 (查询新表)
 */
export async function getDetailedClaim(db: D1Database, adId: string, bXId: string): Promise<AdRewardClaimRecord | null> {
	return await db.prepare(
		"SELECT * FROM ad_reward_claims WHERE ad_id = ? AND b_x_id = ?"
	).bind(adId, bXId).first<AdRewardClaimRecord>();
}

/**
 * 更新状态
 */
export async function updateClaimStatus(
	db: D1Database,
	claimId: string,
	newStatus: ClaimStatus
): Promise<boolean> {
	const result = await db.prepare(
		"UPDATE ad_reward_claims SET status = ?, updated_at = datetime('now') WHERE claim_id = ?"
	).bind(newStatus, claimId).run();

	return result.success;
}

/**
 * 广告主查询消费流水
 */
export async function getAdvertiserHistory(
	db: D1Database,
	aXId: string,
	limit: number = 20,
	offset: number = 0
): Promise<AdRewardClaimRecord[]> {
	// 需要联表查询 ad_campaigns 来获取 a_x_id
	const sql = `
		SELECT c.*, a.title as ad_title
		FROM ad_reward_claims c
		JOIN ad_campaigns a ON c.ad_id = a.ad_id
		WHERE a.a_x_id = ?
		ORDER BY c.created_at DESC
		LIMIT ? OFFSET ?
	`;
	const { results } = await db.prepare(sql).bind(aXId, limit, offset).all<AdRewardClaimRecord>();
	return results ?? [];
}

/**
 * 领取人查询收入流水
 */
export async function getPerformerHistory(
	db: D1Database,
	bXId: string,
	limit: number = 20,
	offset: number = 0
): Promise<AdRewardClaimRecord[]> {
	const sql = `
        SELECT c.*, a.title as ad_title
        FROM ad_reward_claims c
        LEFT JOIN ad_campaigns a ON c.ad_id = a.ad_id
        WHERE c.b_x_id = ?
        ORDER BY c.created_at DESC
        LIMIT ? OFFSET ?
    `;
	const { results } = await db.prepare(sql).bind(bXId, limit, offset).all<AdRewardClaimRecord>();
	return results ?? [];
}


// ========= 广告托管账户和账本操作 =========

/**
 * 检查或创建广告托管账户（确保账户存在）
 * @param db - D1 数据库实例
 * @param aXId - 广告主 X ID
 * @returns 操作是否成功
 */
export async function ensureEscrowAccount(db: D1Database, aXId: string): Promise<boolean> {
	const result = await db.prepare(`
		INSERT OR IGNORE INTO ad_escrow_accounts(a_x_id, asset_symbol, available_atomic, frozen_atomic, created_at, updated_at)
		VALUES(?, 'USDC', '0', '0', datetime('now'), datetime('now'))
	`).bind(aXId).run();
	return result.success ?? false;
}

/**
 * 查询广告发布者的仪表盘统计数据
 * 一次性获取活跃广告数、今日花费和本周花费
 */
export async function getPublisherDashboardStats(db: D1Database, aXId: string) {
	const sql = `
		SELECT 
			(SELECT COUNT(*) FROM ad_campaigns 
			 WHERE a_x_id = ? 
			   AND status = 'ACTIVE'
			   AND end_date > datetime('now')
			   AND quota_used < quota_total) as active_campaigns_count,
			(SELECT COALESCE(SUM(ac.unit_price_atomic), '0') FROM ad_reward_claims arc
			 JOIN ad_campaigns ac ON arc.ad_id = ac.ad_id
			 WHERE ac.a_x_id = ?
			   AND arc.status IN ('CONFIRMED', 'SETTLED_TIMEOUT')
			   AND date(arc.created_at) = date('now')) as today_spend_atomic,
			(SELECT COALESCE(SUM(ac.unit_price_atomic), '0') FROM ad_reward_claims arc
			 JOIN ad_campaigns ac ON arc.ad_id = ac.ad_id
			 WHERE ac.a_x_id = ?
			   AND arc.status IN ('CONFIRMED', 'SETTLED_TIMEOUT')
			   AND date(arc.created_at) >= date('now', '-7 days')) as week_spend_atomic
	`;
	
	const result = await db.prepare(sql).bind(aXId, aXId, aXId).first<{
		active_campaigns_count: number;
		today_spend_atomic: string;
		week_spend_atomic: string;
	}>();
	
	return {
		active_campaigns_count: result?.active_campaigns_count ?? 0,
		today_spend_atomic: result?.today_spend_atomic ?? "0",
		week_spend_atomic: result?.week_spend_atomic ?? "0"
	};
}

/**
 * 查询现有的托管账本记录（用于幂等性检查）
 * @param db - D1 数据库实例
 * @param aXId - 广告主 X ID
 * @param direction - 方向: DEPOSIT 或 WITHDRAW
 * @param requestId - 请求 ID（对于 WITHDRAW）或 null（对于 DEPOSIT，使用 txHash）
 * @returns 账本记录或 null
 */
export async function getEscrowLedgerByRequestId(
	db: D1Database,
	aXId: string,
	direction: 'DEPOSIT' | 'WITHDRAW',
	requestId: string | null
): Promise<AdEscrowLedgerRow | null> {
	if (!requestId) return null;

	const stmt = db.prepare(`
		SELECT * FROM ad_escrow_ledger
		WHERE a_x_id = ? AND direction = ? AND request_id = ?
		LIMIT 1
	`).bind(aXId, direction, requestId);
	return await stmt.first<AdEscrowLedgerRow>();
}

/**
 * 查询现有的托管账本记录（根据 tx_hash）
 * @param db - D1 数据库实例
 * @param txHash - 交易哈希
 * @returns 账本记录或 null
 */
export async function getEscrowLedgerByTxHash(
	db: D1Database,
	txHash: string
): Promise<AdEscrowLedgerRow | null> {
	const stmt = db.prepare(`
		SELECT * FROM ad_escrow_ledger
		WHERE tx_hash = ?
		LIMIT 1
	`).bind(txHash);
	return await stmt.first<AdEscrowLedgerRow>();
}

/**
 * 插入新的托管账本记录（存款）
 * 使用 ON CONFLICT 防止重复计费
 * @param db - D1 数据库实例
 * @param ledgerId - 账本 ID (UUID)
 * @param aXId - 广告主 X ID
 * @param amountAtomic - 金额（原子单位）
 * @param txHash - 交易哈希
 * @param payerAddress - 支付者地址
 * @param treasuryAddress - 库账户地址
 * @returns 是否实际插入了新行 (changes > 0)
 */
export async function insertDepositLedger(
	db: D1Database,
	ledgerId: string,
	aXId: string,
	amountAtomic: string,
	txHash: string,
	payerAddress: string,
	treasuryAddress: string
): Promise<boolean> {
	const result = await db.prepare(`
		INSERT INTO ad_escrow_ledger(
			ledger_id, a_x_id, direction, asset_symbol, amount_atomic,
			payer_address, receiver_address, tx_hash, status, created_at, updated_at
		)
		VALUES(?, ?, 'DEPOSIT', 'USDC', ?, ?, ?, ?, 'SETTLED', datetime('now'), datetime('now'))
		ON CONFLICT(tx_hash) DO NOTHING
	`).bind(ledgerId, aXId, amountAtomic, payerAddress, treasuryAddress, txHash).run();

	return result.success && (result.meta.changes ?? 0) > 0;
}

/**
 * 增加托管账户的可用余额（用于存款）
 * @param db - D1 数据库实例
 * @param aXId - 广告主 X ID
 * @param amountAtomic - 金额（原子单位）
 * @returns 操作是否成功
 */
export async function creditEscrowBalance(
	db: D1Database,
	aXId: string,
	amountAtomic: string
): Promise<boolean> {
	const result = await db.prepare(`
		UPDATE ad_escrow_accounts
		SET available_atomic = CAST(available_atomic AS INTEGER) + ?,
		    updated_at = datetime('now')
		WHERE a_x_id = ? AND asset_symbol = 'USDC'
	`).bind(amountAtomic, aXId).run();

	return result.success ?? false;
}

/**
 * 插入新的提现账本记录（待处理）
 * @param db - D1 数据库实例
 * @param ledgerId - 账本 ID (UUID)
 * @param aXId - 广告主 X ID
 * @param amountAtomic - 金额（原子单位）
 * @param receiverAddress - 接收者地址
 * @param requestId - 请求 ID（幂等性密钥）
 * @returns 是否实际插入了新行
 */
export async function insertWithdrawLedger(
	db: D1Database,
	ledgerId: string,
	aXId: string,
	amountAtomic: string,
	receiverAddress: string,
	requestId: string
): Promise<boolean> {
	const result = await db.prepare(`
		INSERT INTO ad_escrow_ledger(
			ledger_id, a_x_id, direction, asset_symbol, amount_atomic,
			receiver_address, status, request_id, created_at, updated_at
		)
		VALUES(?, ?, 'WITHDRAW', 'USDC', ?, ?, 'PENDING', ?, datetime('now'), datetime('now'))
	`).bind(ledgerId, aXId, amountAtomic, receiverAddress, requestId).run();

	return result.success && (result.meta.changes ?? 0) > 0;
}

/**
 * 扣减托管账户的可用余额（用于提现）
 * @param db - D1 数据库实例
 * @param aXId - 广告主 X ID
 * @param amountAtomic - 金额（原子单位）
 * @returns 操作是否成功
 */
export async function debitEscrowBalance(
	db: D1Database,
	aXId: string,
	amountAtomic: string
): Promise<boolean> {
	const result = await db.prepare(`
		UPDATE ad_escrow_accounts
		SET available_atomic = CAST(available_atomic AS INTEGER) - ?,
		    updated_at = datetime('now')
		WHERE a_x_id = ? AND asset_symbol = 'USDC'
		  AND CAST(available_atomic AS INTEGER) >= ?
	`).bind(amountAtomic, aXId, amountAtomic).run();

	return result.success && (result.meta.changes ?? 0) > 0;
}

/**
 * 更新提现账本记录为已结算
 * @param db - D1 数据库实例
 * @param ledgerId - 账本 ID
 * @param txHash - 交易哈希
 * @param payerAddress - 支付者地址
 * @returns 操作是否成功
 */
export async function settleWithdrawLedger(
	db: D1Database,
	ledgerId: string,
	txHash: string,
	payerAddress: string
): Promise<boolean> {
	const result = await db.prepare(`
		UPDATE ad_escrow_ledger
		SET tx_hash = ?, payer_address = ?, status = 'SETTLED', updated_at = datetime('now')
		WHERE ledger_id = ?
	`).bind(txHash, payerAddress, ledgerId).run();

	return result.success ?? false;
}

/**
 * 更新提现账本记录为失败并退款
 * @param db - D1 数据库实例
 * @param ledgerId - 账本 ID
 * @param errorReason - 错误原因
 * @returns 操作是否成功
 */
export async function failWithdrawLedger(
	db: D1Database,
	ledgerId: string,
	errorReason: string
): Promise<boolean> {
	const result = await db.prepare(`
		UPDATE ad_escrow_ledger
		SET status = 'FAILED', error_reason = ?, updated_at = datetime('now')
		WHERE ledger_id = ?
	`).bind(errorReason, ledgerId).run();

	return result.success ?? false;
}

/**
 * 退款：增加余额（用于提现失败）
 * @param db - D1 数据库实例
 * @param aXId - 广告主 X ID
 * @param amountAtomic - 金额（原子单位）
 * @returns 操作是否成功
 */
export async function refundEscrowBalance(
	db: D1Database,
	aXId: string,
	amountAtomic: string
): Promise<boolean> {
	const result = await db.prepare(`
		UPDATE ad_escrow_accounts
		SET available_atomic = CAST(available_atomic AS INTEGER) + ?,
		    updated_at = datetime('now')
		WHERE a_x_id = ? AND asset_symbol = 'USDC'
	`).bind(amountAtomic, aXId).run();

	return result.success ?? false;
}

/**
 * 查询广告托管账本记录列表（充值/提现历史）
 * @param db - D1 数据库实例
 * @param aXId - 广告主 X ID
 * @param limit - 返回记录数（最大 200）
 * @param offset - 分页偏移
 * @returns 账本记录列表
 */
export async function listAdEscrowLedger(
	db: D1Database,
	aXId: string,
	limit: number = 50,
	offset: number = 0
): Promise<AdEscrowLedgerRow[]> {
	// 限制 limit 的最大值
	const safeLim = Math.min(Math.max(limit, 1), 200);
	const safeOffset = Math.max(offset, 0);

	const sql = `
		SELECT
			ledger_id, a_x_id, direction as op, asset_symbol, amount_atomic,
			payer_address as payer, receiver_address as to_address,
			tx_hash, request_id, status, error_reason,
			created_at, updated_at
		FROM ad_escrow_ledger
		WHERE a_x_id = ?
		ORDER BY created_at DESC
		LIMIT ? OFFSET ?
	`;

	const result = await db.prepare(sql)
		.bind(aXId, safeLim, safeOffset)
		.all<AdEscrowLedgerRow>();

	return result.results ?? [];
}
