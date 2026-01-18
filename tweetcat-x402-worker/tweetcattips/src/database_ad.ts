import type {D1Database} from "@cloudflare/workers-types";

// ========= 类型定义 =========

export type AdCategory = "follow" | "visit" | "register" | "share";

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
	unit_price_atomic: string;
	quota_total: number;
	quota_used: number;
	status: string;
	start_at?: string | null;
	end_at?: string | null;
	created_at?: string | null;
	rules_json?: string | null;
	updated_at?: string | null;
}

export interface ClaimRow {
	claim_id: string;
	ad_id: string;
	a_x_id: string;
	b_x_id: string;
	b_wallet: string;
	status: string;
	unit_price_atomic: string;
	created_at?: string | null;
	ad_title?: string;
	expires_at?: string | null;
}

export interface AdCreatePayload {
	adId: string;
	aXId: string;
	category: string;
	name: string;
	title: string;
	description: string;
	detailUrl: string;
	unitPriceAtomic: string;
	quotaTotal: number;
	startAt?: string | null;
	endAt?: string | null;
	rulesJson?: string | null;
}

export interface ClaimCreatePayload {
	claimId: string;
	adId: string;
	aXId: string;
	bXId: string;
	bWallet: string;
	unitPriceAtomic: string;
	expiresAt: string;
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

// ========= 辅助函数 =========

export function toSqliteDate(date: Date): string {
	return date.toISOString().replace("T", " ").replace("Z", "");
}

export function formatDeadlineText(endAt?: string | null): string {
	if (!endAt) return "Ends: -";
	const dateText = endAt.toString().trim().slice(0, 10);
	return `Ends: ${dateText || "-"}`;
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
			ad_id, a_x_id, category, name, title, description, detail_url,
			unit_price_atomic, quota_total, rules_json, start_at, end_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
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
			payload.unitPriceAtomic,
			payload.quotaTotal,
			payload.rulesJson ?? null,
			payload.startAt ?? null,
			payload.endAt ?? null
		)
		.run();

	return result.success;
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
		SELECT ad_id, title, a_x_id, description, category, unit_price_atomic,
		       quota_used, quota_total, end_at, created_at, detail_url
		FROM ad_campaigns
		WHERE status = 'ACTIVE'
		  AND quota_used < quota_total
		  AND (end_at IS NULL OR end_at = '' OR datetime(end_at) > datetime('now'))
		ORDER BY created_at DESC
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
		        category, name, title, description, detail_url, rules_json,
		        start_at, end_at, created_at, updated_at
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

// ========= 领取记录操作 =========

/**
 * 检查用户是否已经领取过某个广告
 * @param db - D1 数据库实例
 * @param adId - 广告 ID
 * @param bXId - 用户 X ID
 * @returns 现有的领取记录或 null
 */
export async function getExistingClaim(db: D1Database, adId: string, bXId: string): Promise<ClaimRow | null> {
	const existingClaim = await db.prepare(
		`SELECT claim_id, ad_id, a_x_id, b_x_id, b_wallet, status, unit_price_atomic,
		        created_at, expires_at
		 FROM claims
		 WHERE ad_id = ? AND b_x_id = ?
		   AND status IN ('CLAIMED', 'PENDING_CONFIRM')
		 ORDER BY created_at DESC
		 LIMIT 1`
	).bind(adId, bXId).first<ClaimRow>();

	return existingClaim ?? null;
}

/**
 * 创建新的领取记录
 * @param db - D1 数据库实例
 * @param payload - 领取记录创建数据
 * @returns 创建是否成功
 */
export async function createClaim(db: D1Database, payload: ClaimCreatePayload): Promise<boolean> {
	const insertSql = `
		INSERT INTO claims (
			claim_id, ad_id, a_x_id, b_x_id, b_wallet, status, unit_price_atomic, expires_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`;
	const result = await db.prepare(insertSql)
		.bind(
			payload.claimId,
			payload.adId,
			payload.aXId,
			payload.bXId,
			payload.bWallet,
			"CLAIMED",
			payload.unitPriceAtomic,
			payload.expiresAt
		)
		.run();

	return result.success;
}

/**
 * 获取用户的所有领取记录
 * @param db - D1 数据库实例
 * @param bXId - 用户 X ID
 * @returns 领取记录列表
 */
export async function getMyClaimsList(db: D1Database, bXId: string): Promise<ClaimRow[]> {
	const sql = `
		SELECT c.claim_id, c.ad_id, c.a_x_id, c.b_x_id, c.b_wallet, c.status,
		       c.created_at, c.expires_at, c.unit_price_atomic,
		       a.title AS ad_title
		FROM claims c
		LEFT JOIN ad_campaigns a ON c.ad_id = a.ad_id
		WHERE c.b_x_id = ?
		ORDER BY c.created_at DESC
		LIMIT 50
	`;
	const result = await db.prepare(sql).bind(bXId).all<ClaimRow>();
	return result.results ?? [];
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
