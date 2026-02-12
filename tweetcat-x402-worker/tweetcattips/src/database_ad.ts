import type { D1Database } from "@cloudflare/workers-types";

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
	quota_claimed?: number;
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
	| 'CONFIRMED'         // 验证通过，已结算
	| 'REJECTED';         // 验证失败或被拒绝

export interface AdRewardClaimRecord {
	claim_id: string;
	ad_id: string;
	b_x_id: string;
	b_wallet: string;
	status: ClaimStatus;
	unit_price_atomic: string;
	created_at: string;
	updated_at: string;
	verified_at?: string | null;
	verification_notes?: string | null;
}

export interface CreateDetailedClaimParams {
	claimId: string;
	adId: string;
	bXId: string;
	bWallet: string;
	unitPriceAtomic: string;
}

export interface ClaimEvidenceParams {
	evidenceId: string;
	claimId: string;
	adId: string;
	bXId: string;
	category: string;
	proofType: string;
	proofData: string; // JSON string
	observedData?: string; // JSON string
}

// ========= 广告广场 feed 元信息 =========

export interface AdsFeedMeta {
	version: number;
	next_invalidation_at: string | null;
}

async function ensureAdsFeedMetaRow(db: D1Database): Promise<void> {
	// 单行表（id=1），幂等初始化
	await db.prepare(
		`INSERT OR IGNORE INTO ads_feed_meta(id, version, updated_at)
		 VALUES(1, 1, datetime('now'))`
	).run();
}

export async function getAdsFeedVersion(db: D1Database): Promise<number> {
	await ensureAdsFeedMetaRow(db);
	const row = await db.prepare(
		"SELECT version FROM ads_feed_meta WHERE id = 1"
	).first<{ version: number }>();
	return Number(row?.version ?? 1);
}

export async function bumpAdsFeedVersion(db: D1Database): Promise<number> {
	await ensureAdsFeedMetaRow(db);
	const res = await db.prepare(
		`UPDATE ads_feed_meta
		 SET version = version + 1,
		     updated_at = datetime('now')
		 WHERE id = 1`
	).run();
	if (!(res.success && (res.meta.changes ?? 0) > 0)) {
		// 极端情况下兜底：重新插入并返回当前版本
		await ensureAdsFeedMetaRow(db);
	}
	return await getAdsFeedVersion(db);
}

export async function getAdsNextInvalidationAt(db: D1Database): Promise<string | null> {
	// 计算下一次“纯时间变化”可能导致 list 变化的时间点：当前可展示广告里最早的 end_date
	const sql = `
		SELECT MIN(c.end_date) as next_invalidation_at
		FROM ad_campaigns c
		JOIN ad_escrow_accounts e ON c.a_x_id = e.a_x_id
		WHERE c.status = 'ACTIVE'
		  AND c.end_date > datetime('now')
		  AND COALESCE(c.quota_claimed, c.quota_used, 0) < c.quota_total
		  AND CAST(e.frozen_atomic AS INTEGER) >= CAST(c.unit_price_atomic AS INTEGER)
	`;
	const row = await db.prepare(sql).first<{ next_invalidation_at: string | null }>();
	return row?.next_invalidation_at ?? null;
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

/**
 * 动态计算广告的逻辑状态
 */
export function getEffectiveStatus(ad: AdRow): AdCampaignStatus {
	const claimed = Number.isFinite(ad.quota_claimed as number) ? (ad.quota_claimed as number) : 0;
	const used = Number.isFinite(ad.quota_used) ? ad.quota_used : 0;
	const capped = Math.max(claimed, used);

	// 1. 检查配额是否用完 (优先于过期，因为可能刚好最后一秒用完)
	// 兼容旧数据：历史上 quota_used 代表“已领取”，新口径用 quota_claimed 代表“已领取”
	if (capped >= ad.quota_total) return 'COMPLETED';

	// 2. 检查时间是否过期
	if (ad.end_date && new Date(ad.end_date) < new Date()) {
		return 'EXPIRED';
	}

	// 3. 手动暂停（仅在未 ended 时生效）
	if (ad.status === 'PAUSED_MANUAL') return 'PAUSED_MANUAL';

	// 4. 返回原始状态 (ACTIVE 或 PAUSED_NO_BUDGET)
	return ad.status;
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
	).bind(aXId).first<{ available_atomic: string }>();
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
 * 增加广告的总配额（用于追加预算）
 * @param db - D1 数据库实例
 * @param adId - 广告 ID
 * @param additionalQuota - 要增加的配额数量
 * @returns 操作是否成功
 */
export async function addAdQuota(
	db: D1Database,
	adId: string,
	additionalQuota: number
): Promise<boolean> {
	const updateSql = `
		UPDATE ad_campaigns
		SET quota_total = quota_total + ?,
			updated_at = datetime('now')
		WHERE ad_id = ?
	`;
	const result = await db.prepare(updateSql)
		.bind(additionalQuota, adId)
		.run();

	return result.success && (result.meta.changes ?? 0) > 0;
}

/**
 * 获取用户的所有广告（支持分页）
 */
export async function getMyAds(
	db: D1Database,
	aXId: string,
	limit: number = 20,
	offset: number = 0
): Promise<AdRow[]> {
	const safeLim = Math.min(Math.max(limit, 1), 200);
	const safeOffset = Math.max(offset, 0);

	const stmt = db.prepare(
		"SELECT * FROM ad_campaigns WHERE a_x_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?"
	).bind(aXId, safeLim, safeOffset);
	const result = await stmt.all<AdRow>();
	const ads = result.results ?? [];

	// 注入动态状态逻辑
	return ads.map(ad => ({
		...ad,
		status: getEffectiveStatus(ad)
	}));
}

/**
 * 根据 ID 获取单个广告
 * @param db - D1 数据库实例
 * @param adId - 广告 ID
 * @returns 广告信息或 null
 */
export async function getAdById(db: D1Database, adId: string): Promise<AdRow | null> {
	const stmt = db.prepare(
		"SELECT * FROM ad_campaigns WHERE ad_id = ?"
	).bind(adId);
	const ad = await stmt.first<AdRow>();
	if (!ad) return null;

	return {
		...ad,
		status: getEffectiveStatus(ad)
	};
}

/**
 * 获取用户的广告总数
 */
export async function getMyAdsCount(db: D1Database, aXId: string): Promise<number> {
	const stmt = db.prepare(
		"SELECT COUNT(*) as total FROM ad_campaigns WHERE a_x_id = ?"
	).bind(aXId);
	const result = await stmt.first<{ total: number }>();
	return result?.total ?? 0;
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
			c.quota_claimed, c.quota_used, c.quota_total, c.end_date, c.created_at, c.detail_url
		FROM
			ad_campaigns c
		JOIN
			ad_escrow_accounts e ON c.a_x_id = e.a_x_id
		WHERE
			c.status = 'ACTIVE'
			AND c.end_date > datetime('now')
			AND COALESCE(c.quota_claimed, c.quota_used, 0) < c.quota_total
			AND CAST(e.frozen_atomic AS INTEGER) >= CAST(c.unit_price_atomic AS INTEGER)
		ORDER BY
			c.created_at DESC
		LIMIT 100
	`;
	const result = await db.prepare(sql).all<AdRow>();
	return result.results ?? [];
}


/**
 * 增加广告的使用配额（领取任务时调用）
 * @param db - D1 数据库实例
 * @param adId - 广告 ID
 * @returns 操作是否成功
 */
export async function incrementAdClaimedQuota(db: D1Database, adId: string): Promise<boolean> {
	const updateResult = await db.prepare(
		`UPDATE ad_campaigns
		 SET quota_claimed = COALESCE(quota_claimed, 0) + 1,
		     updated_at = datetime('now')
		 WHERE ad_id = ? 
		   AND status = 'ACTIVE' 
		   AND COALESCE(quota_claimed, 0) < quota_total
		   AND end_date > datetime('now')`
	).bind(adId).run();

	return updateResult.success && (updateResult.meta.changes ?? 0) > 0;
}

// ========= 新的领取记录操作 (ad_reward_claims) =========

/**
 * 创建新的详细领取记录 (仅占位，状态默认为 CLAIMED)
 */
export async function createDetailedClaim(db: D1Database, params: CreateDetailedClaimParams): Promise<boolean> {
	const sql = `
		INSERT INTO ad_reward_claims (
			claim_id, ad_id, b_x_id, b_wallet, status, unit_price_atomic
		) VALUES (?, ?, ?, ?, 'CLAIMED', ?)
	`;

	try {
		const result = await db.prepare(sql).bind(
			params.claimId,
			params.adId,
			params.bXId,
			params.bWallet,
			params.unitPriceAtomic
		).run();

		return result.success;
	} catch (e) {
		console.error("Failed to create detailed claim:", e);
		return false;
	}
}

/**
 * 插入证据记录
 */
export async function insertClaimEvidence(db: D1Database, params: ClaimEvidenceParams): Promise<boolean> {
	const sql = `
		INSERT INTO ad_claim_evidence (
			evidence_id, claim_id, ad_id, b_x_id, category, proof_type, proof_data, observed_data
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`;

	try {
		const result = await db.prepare(sql).bind(
			params.evidenceId,
			params.claimId,
			params.adId,
			params.bXId,
			params.category,
			params.proofType,
			params.proofData,
			params.observedData ?? null
		).run();
		return result.success;
	} catch (e) {
		console.error("Failed to insert claim evidence:", e);
		return false;
	}
}

/**
 * 获取单个 Claim
 */
export async function getClaimById(db: D1Database, claimId: string): Promise<AdRewardClaimRecord | null> {
	return await db.prepare(
		"SELECT * FROM ad_reward_claims WHERE claim_id = ?"
	).bind(claimId).first<AdRewardClaimRecord>();
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
		SELECT c.*, a.title as ad_title, a.unit_price_atomic
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
 * 获取广告主消费记录总数
 */
export async function getAdvertiserHistoryCount(db: D1Database, aXId: string): Promise<number> {
	const sql = `
		SELECT COUNT(*) as total
		FROM ad_reward_claims c
		JOIN ad_campaigns a ON c.ad_id = a.ad_id
		WHERE a.a_x_id = ?
	`;
	const result = await db.prepare(sql).bind(aXId).first<{ total: number }>();
	return result?.total ?? 0;
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

/**
 * 获取执行者的仪表盘统计数据
 */
export async function getPerformerDashboardStats(db: D1Database, bXId: string) {
	const sql = `
		SELECT 
			COALESCE(SUM(CASE WHEN status = 'CONFIRMED' THEN CAST(unit_price_atomic AS INTEGER) ELSE 0 END), 0) as withdrawable_atomic,
			COALESCE(SUM(CASE WHEN status IN ('CLAIMED', 'PENDING_CONFIRM') THEN CAST(unit_price_atomic AS INTEGER) ELSE 0 END), 0) as pending_atomic,
			COALESCE(SUM(CASE WHEN created_at >= date('now', 'start of day') AND status IN ('CLAIMED', 'PENDING_CONFIRM', 'CONFIRMED') THEN CAST(unit_price_atomic AS INTEGER) ELSE 0 END), 0) as today_earned_atomic,
			COALESCE(SUM(CASE WHEN status IN ('CLAIMED', 'PENDING_CONFIRM', 'CONFIRMED') THEN CAST(unit_price_atomic AS INTEGER) ELSE 0 END), 0) as total_earned_atomic
		FROM ad_reward_claims
		WHERE b_x_id = ?
	`;
	return await db.prepare(sql).bind(bXId).first<{
		withdrawable_atomic: number;
		pending_atomic: number;
		today_earned_atomic: number;
		total_earned_atomic: number;
	}>();
}

/**
 * 执行者任务列表（含广告详情）
 * 用于 My Tasks 页签，返回任务 + 关联广告信息
 */
export interface TaskWithAdInfo {
	claim_id: string;
	ad_id: string;
	status: ClaimStatus;
	created_at: string;
	ad: {
		title: string;
		brand: string;
		category: string;
		rewardUSDC: number;
		detailUrl: string;
		durationMinutes: number;
		deadlineText: string;
	};
}

export async function getPerformerTasksWithAdInfo(
	db: D1Database,
	bXId: string,
	status: string,
	limit: number,
	offset: number
): Promise<TaskWithAdInfo[]> {
	let statusFilter = "";
	if (status !== "all") {
		const statusMap: Record<string, string[]> = {
			pending: ["CLAIMED", "PENDING_CONFIRM"],
			confirmed: ["CONFIRMED"],
			rejected: ["REJECTED"]
		};
		const statuses = statusMap[status] || [];
		if (statuses.length > 0) {
			statusFilter = `AND c.status IN (${statuses.map(s => `'${s}'`).join(",")})`;
		}
	}

	const sql = `
		SELECT 
			c.claim_id,
			c.ad_id,
			c.status,
			c.created_at,
			a.title,
			a.category,
			a.unit_price_atomic,
			a.detail_url,
			a.a_x_id,
			a.end_date
		FROM ad_reward_claims c
		JOIN ad_campaigns a ON c.ad_id = a.ad_id
		WHERE c.b_x_id = ? ${statusFilter}
		ORDER BY c.created_at DESC
		LIMIT ? OFFSET ?
	`;

	const { results } = await db.prepare(sql).bind(bXId, limit, offset).all<any>();
	return (results ?? []).map(row => ({
		claim_id: row.claim_id,
		ad_id: row.ad_id,
		status: row.status as ClaimStatus,
		created_at: row.created_at,
		ad: {
			title: row.title || "Unknown Ad",
			brand: `@${row.a_x_id || "unknown"}`,
			category: row.category || "follow",
			rewardUSDC: Number(row.unit_price_atomic || 0) / 1_000_000,
			detailUrl: row.detail_url || "",
			durationMinutes: CATEGORY_DURATION[row.category as AdCategory] ?? 3,
			deadlineText: formatDeadlineText(row.end_date)
		}
	}));
}

export async function getPerformerTasksCount(
	db: D1Database,
	bXId: string,
	status: string
): Promise<number> {
	let statusFilter = "";
	if (status !== "all") {
		const statusMap: Record<string, string[]> = {
			pending: ["CLAIMED", "PENDING_CONFIRM"],
			confirmed: ["CONFIRMED"],
			rejected: ["REJECTED"]
		};
		const statuses = statusMap[status] || [];
		if (statuses.length > 0) {
			statusFilter = `AND c.status IN (${statuses.map(s => `'${s}'`).join(",")})`;
		}
	}

	const sql = `
		SELECT COUNT(*) as total
		FROM ad_reward_claims c
		WHERE c.b_x_id = ? ${statusFilter}
	`;

	const row = await db.prepare(sql).bind(bXId).first<{ total: number }>();
	return row?.total ?? 0;
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
	const balanceResult = await db.prepare(
		"SELECT available_atomic as balance_atomic, frozen_atomic FROM ad_escrow_accounts WHERE a_x_id = ? AND asset_symbol = 'USDC'"
	).bind(aXId).first<{ balance_atomic: string, frozen_atomic: string }>();

	const statsSql = `
		SELECT 
			(SELECT COUNT(*) FROM ad_campaigns 
			 WHERE a_x_id = ? 
			   AND status = 'ACTIVE'
			   AND end_date > datetime('now')
			   AND COALESCE(quota_claimed, quota_used, 0) < quota_total) as active_campaigns_count,
			(SELECT COALESCE(SUM(ac.unit_price_atomic), '0') FROM ad_reward_claims arc
			 JOIN ad_campaigns ac ON arc.ad_id = ac.ad_id
			 WHERE ac.a_x_id = ?
			   AND arc.status IN ('CONFIRMED', 'SETTLED_TIMEOUT')
			   AND date(arc.created_at) = date('now')) as today_spend_atomic,
			(SELECT COALESCE(SUM(ac.unit_price_atomic), '0') FROM ad_reward_claims arc
			 JOIN ad_campaigns ac ON arc.ad_id = ac.ad_id
			 WHERE ac.a_x_id = ?
			   AND arc.status IN ('CONFIRMED', 'SETTLED_TIMEOUT')
			   AND date(arc.created_at) >= date('now', '-7 days')) as week_spend_atomic,
			(SELECT MAX(created_at) FROM ad_escrow_ledger 
			 WHERE a_x_id = ? 
			   AND op = 'WITHDRAW' 
			   AND status = 'SETTLED') as last_withdraw_at
	`;

	const statsResult = await db.prepare(statsSql).bind(aXId, aXId, aXId, aXId).first<{
		active_campaigns_count: number;
		today_spend_atomic: string;
		week_spend_atomic: string;
		last_withdraw_at: string | null;
	}>();

	return {
		balance_atomic: balanceResult?.balance_atomic ?? "0",
		frozen_atomic: balanceResult?.frozen_atomic ?? "0",
		active_campaigns_count: statsResult?.active_campaigns_count ?? 0,
		today_spend_atomic: statsResult?.today_spend_atomic ?? "0",
		week_spend_atomic: statsResult?.week_spend_atomic ?? "0",
		last_withdraw_at: statsResult?.last_withdraw_at ?? null
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

/**
 * 结算广告奖励 (原子操作)
 * 1. 扣减广告主冻结余额 (WHERE frozen >= reward)
 * 2. 增加执行者可用余额 (UPSERT)
 * 3. 更新 Claim 状态为 CONFIRMED
 */
export async function settleAdReward(
	db: D1Database,
	params: {
		claimId: string;
		adId: string;
		aXId: string; // 广告主
		bXId: string; // 执行者
		rewardAtomic: string;
	}
): Promise<boolean> {
	const { claimId, adId, aXId, bXId, rewardAtomic } = params;

	// 1. 扣减广告主冻结余额 (注意：这里用的是 frozen_atomic，因为发布广告时已预留)
	const deductFrozenSql = `
		UPDATE ad_escrow_accounts
		SET frozen_atomic = CAST(frozen_atomic AS INTEGER) - ?,
		    updated_at = datetime('now')
		WHERE a_x_id = ? AND asset_symbol = 'USDC'
		  AND CAST(frozen_atomic AS INTEGER) >= ?
	`;

	// 2. 增加执行者可用余额 (如果账户不存在则创建)
	const creditPerformerSql = `
		INSERT INTO ad_escrow_accounts (a_x_id, asset_symbol, available_atomic, frozen_atomic, created_at, updated_at)
		VALUES (?, 'USDC', ?, 0, datetime('now'), datetime('now'))
		ON CONFLICT(a_x_id, asset_symbol) DO UPDATE SET
			available_atomic = CAST(available_atomic AS INTEGER) + ?,
			updated_at = datetime('now')
	`;

	// 3. 更新 Claim 状态
	const updateClaimSql = `
		UPDATE ad_reward_claims
		SET status = 'CONFIRMED', verified_at = datetime('now'), updated_at = datetime('now')
		WHERE claim_id = ? AND status IN ('CLAIMED', 'PENDING_CONFIRM')
	`;

	// 4. 更新广告使用的配额 quota_used
	// 这一步至关重要，用于后续计算退回预算时的剩余额度
	const updateAdQuotaSql = `
		UPDATE ad_campaigns
		SET quota_used = COALESCE(quota_used, 0) + 1, updated_at = datetime('now')
		WHERE ad_id = ?
	`;

	try {
		const batch = await db.batch([
			db.prepare(deductFrozenSql).bind(rewardAtomic, aXId, rewardAtomic),
			db.prepare(creditPerformerSql).bind(bXId, rewardAtomic, rewardAtomic),
			db.prepare(updateClaimSql).bind(claimId),
			db.prepare(updateAdQuotaSql).bind(adId)
		]);

		if (!batch || batch.length < 4) return false;

		// 检查扣费是否有影响行数（如果余额不足，changes=0）
		// batch[0] 是扣费结果
		if ((batch[0].meta.changes ?? 0) === 0) {
			console.error(`Settle failed: Insufficient frozen balance for advertiser ${aXId}`);
			return false;
		}

		return true;
	} catch (e) {
		console.error("Failed to settle ad reward:", e);
		return false;
	}
}

/**
 * 拒绝广告奖励 (更新状态为 REJECTED)
 */
export async function rejectAdReward(db: D1Database, claimId: string, reason: string): Promise<boolean> {
	const sql = `
		UPDATE ad_reward_claims
		SET status = 'REJECTED', updated_at = datetime('now')
		WHERE claim_id = ? AND status IN ('CLAIMED', 'PENDING_CONFIRM')
	`;
	const result = await db.prepare(sql).bind(claimId).run();

	// 如果是 REJECTED，理论上应该退回 quota_claimed (或者不退回，视业务逻辑而定)
	// 目前 v1 简单处理：拒绝就不发钱，但 quota_claimed 已经占用了。
	// 如果需要退回 quota，可以在这里加。但考虑到防刷，可能不退 quota 反而更能遏制恶意刷单。

	return result.success ?? false;
}

/**
 * 获取待结算的 Claim 列表 (超过指定小时数且状态为 PENDING_CONFIRM)
 */
export async function getPendingSettlementClaims(
	db: D1Database,
	delayHours: number = 24,
	limit: number = 50
): Promise<{
	claim_id: string;
	ad_id: string;
	a_x_id: string;
	b_x_id: string;
	unit_price_atomic: string;
	proof_data: string | null;
	proof_type: string | null;
	category: string | null;
}[]> {
	const sql = `
		SELECT c.claim_id, c.ad_id, a.a_x_id, c.b_x_id, c.unit_price_atomic,
			   e.proof_data, e.proof_type, e.category
		FROM ad_reward_claims c
		JOIN ad_campaigns a ON c.ad_id = a.ad_id
		LEFT JOIN ad_claim_evidence e ON c.claim_id = e.claim_id
		WHERE c.status = 'PENDING_CONFIRM'
		  AND c.updated_at <= datetime('now', '-' || ? || ' hours')
		LIMIT ?
	`;

	const { results } = await db.prepare(sql).bind(delayHours, limit).all<{
		claim_id: string;
		ad_id: string;
		a_x_id: string;
		b_x_id: string;
		unit_price_atomic: string;
		proof_data: string | null;
		proof_type: string | null;
		category: string | null;
	}>();

	return results ?? [];
}

/**
 * 获取可以进行预算退回的已结束广告列表
 * 条件：状态为 EXPIRED/COMPLETED 且 budget_settlement_status 为 NONE
 */
export async function getAdsForRefund(
	db: D1Database,
	limit: number = 20
): Promise<AdRow[]> {
	const sql = `
		SELECT * FROM ad_campaigns
		WHERE status IN ('EXPIRED', 'COMPLETED')
		  AND budget_settlement_status = 'NONE'
		LIMIT ?
	`;
	const { results } = await db.prepare(sql).bind(limit).all<AdRow>();
	return results ?? [];
}

/**
 * 检查广告是否还有待处理的 Claim
 */
export async function hasPendingClaimsForAd(
	db: D1Database,
	adId: string
): Promise<boolean> {
	const sql = `
		SELECT COUNT(*) as total FROM ad_reward_claims
		WHERE ad_id = ? AND status IN ('CLAIMED', 'PENDING_CONFIRM')
	`;
	const res = await db.prepare(sql).bind(adId).first<{ total: number }>();
	return (res?.total ?? 0) > 0;
}

/**
 * 执行预算退回 (将 frozen 退回 available)
 */
export async function refundAdBudget(
	db: D1Database,
	adId: string,
	aXId: string
): Promise<boolean> {
	const getAdSql = "SELECT unit_price_atomic, quota_total, quota_used FROM ad_campaigns WHERE ad_id = ?";
	const ad = await db.prepare(getAdSql).bind(adId).first<AdRow>();
	if (!ad) return false;

	const unitPrice = BigInt(ad.unit_price_atomic);
	const remainingQuota = BigInt(ad.quota_total) - BigInt(ad.quota_used);
	const refundAmount = remainingQuota * unitPrice;

	if (refundAmount <= 0n) {
		await db.prepare("UPDATE ad_campaigns SET budget_settlement_status = 'SETTLED', updated_at = datetime('now') WHERE ad_id = ?").bind(adId).run();
		return true;
	}

	const refundAmountStr = refundAmount.toString();

	const refundSql = `
		UPDATE ad_escrow_accounts
		SET available_atomic = CAST(available_atomic AS INTEGER) + ?,
		    frozen_atomic = CAST(frozen_atomic AS INTEGER) - ?,
		    updated_at = datetime('now')
		WHERE a_x_id = ? AND asset_symbol = 'USDC'
		  AND CAST(frozen_atomic AS INTEGER) >= ?
	`;

	const updateAdStatusSql = `
		UPDATE ad_campaigns
		SET budget_settlement_status = 'SETTLED', updated_at = datetime('now')
		WHERE ad_id = ?
	`;

	try {
		const batch = await db.batch([
			db.prepare(refundSql).bind(refundAmountStr, refundAmountStr, aXId, refundAmountStr),
			db.prepare(updateAdStatusSql).bind(adId)
		]);

		return (batch && batch[0].meta.changes > 0);
	} catch (e) {
		console.error(`Failed to refund budget for ad ${adId}:`, e);
		return false;
	}
}
