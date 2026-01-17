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

export interface AdAccountRow {
	a_x_id: string;
	asset_symbol: string;
	balance_atomic: string;
}

export interface AdRow {
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
	created_at?: string | null;
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
	adType: string;
	category: string;
	name: string;
	title: string;
	description: string;
	detailUrl: string;
	unitPriceAtomic: string;
	quotaTotal: number;
	startAt?: string | null;
	endAt?: string | null;
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
 * 获取广告账户余额
 * @param db - D1 数据库实例
 * @param aXId - 广告主 X ID
 * @returns 账户信息或 null
 */
export async function getAdAccountBalance(db: D1Database, aXId: string): Promise<AdAccountRow | null> {
	const stmt = db.prepare(
		"SELECT a_x_id, asset_symbol, balance_atomic FROM ad_account WHERE a_x_id = ?"
	).bind(aXId);
	return await stmt.first<AdAccountRow>();
}

/**
 * 扣减广告账户余额（仅当余额足够时）
 * @param db - D1 数据库实例
 * @param aXId - 广告主 X ID
 * @param amount - 要扣减的金额（原子单位）
 * @returns 操作是否成功
 */
export async function deductAdAccountBalance(db: D1Database, aXId: string, amount: string): Promise<boolean> {
	const updateSql = `
		UPDATE ad_account
		SET balance_atomic = CAST(balance_atomic AS INTEGER) - ?,
			updated_at = datetime('now')
		WHERE a_x_id = ?
		  AND CAST(balance_atomic AS INTEGER) >= ?
	`;
	const updateResult = await db.prepare(updateSql)
		.bind(amount, aXId, amount)
		.run();

	return updateResult.success && (updateResult.meta.changes ?? 0) > 0;
}

/**
 * 获取账户信息
 * @param db - D1 数据库实例
 * @param aXId - 广告主 X ID
 * @returns 账户信息结构体
 */
export async function getAccountBalanceAtomic(db: D1Database, aXId: string): Promise<AdAccountInfo> {
	const balanceRow = await db.prepare(
		"SELECT balance_atomic FROM ad_account WHERE a_x_id = ?"
	).bind(aXId).first<{balance_atomic: string}>();
	return {
		balanceAtomic: balanceRow?.balance_atomic ?? "0"
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
		INSERT INTO ads (
			ad_id, a_x_id, ad_type, category, name, title, description, detail_url,
			unit_price_atomic, quota_total, start_at, end_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`;
	const result = await db.prepare(insertSql)
		.bind(
			payload.adId,
			payload.aXId,
			payload.adType,
			payload.category,
			payload.name,
			payload.title,
			payload.description,
			payload.detailUrl,
			payload.unitPriceAtomic,
			payload.quotaTotal,
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
		"SELECT * FROM ads WHERE a_x_id = ? ORDER BY created_at DESC LIMIT 200"
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
		FROM ads
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
		        ad_type, category, name, title, description, detail_url,
		        start_at, end_at, created_at
		 FROM ads
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
		`UPDATE ads
		 SET quota_used = quota_used + 1
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
		LEFT JOIN ads a ON c.ad_id = a.ad_id
		WHERE c.b_x_id = ?
		ORDER BY c.created_at DESC
		LIMIT 50
	`;
	const result = await db.prepare(sql).bind(bXId).all<ClaimRow>();
	return result.results ?? [];
}
