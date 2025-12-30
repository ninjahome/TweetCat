export const TIP_RECORD_PENDING = 0
export const TIP_RECORD_CLAIMED = 10
export type TIP_STATUS = typeof TIP_RECORD_PENDING | typeof TIP_RECORD_CLAIMED

export const REWARD_STATUS_PENDING = 0
export const REWARD_STATUS_LOCKED = 10
export const REWARD_STATUS_SUCCESS = 20
export const REWARD_STATUS_FAILED = 30
export const REWARD_STATUS_CANCELLED = 40

export type REWARD_STATUS =
	typeof REWARD_STATUS_PENDING
	| typeof REWARD_STATUS_LOCKED
	| typeof REWARD_STATUS_SUCCESS
	| typeof REWARD_STATUS_FAILED
	| typeof REWARD_STATUS_CANCELLED


export async function getKolBinding(db: D1Database, xId: string): Promise<string | null> {
	const stmt = db.prepare("SELECT wallet_address FROM kol_binding WHERE x_id = ?").bind(xId);
	const row = await stmt.first<{ wallet_address: string }>();
	return row?.wallet_address ?? null;
}

export interface TipRecord {
	xId: string;
	amountAtomic: string;
}

export async function recordEscrowTips(db: D1Database, params: TipRecord) {
	const sql = `
		INSERT INTO tip_escrow (x_id, amount_atomic)
		VALUES (?, ?) ON CONFLICT(x_id) DO
		UPDATE SET
			amount_atomic = CAST (tip_escrow.amount_atomic AS INTEGER) + CAST (excluded.amount_atomic AS INTEGER),
			updated_at = CURRENT_TIMESTAMP
		WHERE status = ${TIP_RECORD_PENDING};
	`;

	const result = await db.prepare(sql)
		.bind(params.xId, params.amountAtomic)
		.run();

	if (!result.success || result.meta.changes === 0) {
		throw new Error(`Failed to record tips: x_id ${params.xId} not found or status is not Pending.`);
	}

	return result;
}

export interface ValidatedUserInfo {
	userId: string;                    // CDP 用户 ID
	walletAddress: string;             // EVM 钱包地址
	walletCreatedAt: string;           // 钱包创建时间
	email: string;                     // 邮箱
	xSub: string;                      // Twitter/X 的 sub (用户ID)
	username: string;                  // Twitter/X 用户名
}

export interface KolBindingRecord {
	x_id: string;                      // Twitter/X 的 sub
	cdp_user_id: string;               // CDP 用户 ID
	wallet_address: string;            // EVM 钱包地址
	email: string;                     // 邮箱
	username: string;                  // Twitter/X 用户名
	evm_account_created_at: string;    // EVM 账户创建时间
	created_at: string;                // 记录创建时间
	signin_time: string;               // 最后登录时间
}

export async function getKolBindingByUserId(
	db: D1Database,
	userId: string
): Promise<KolBindingRecord | null> {
	const stmt = db.prepare(
		"SELECT * FROM kol_binding WHERE cdp_user_id = ?"
	).bind(userId);

	return await stmt.first<KolBindingRecord>();
}

export async function updateUserSigninTime(
	db: D1Database,
	x_id: string
): Promise<void> {
	await db.prepare(
		"UPDATE kol_binding SET signin_time = datetime('now') WHERE x_id = ?"
	).bind(x_id).run();
}

export async function createKolBinding(
	db: D1Database,
	userInfo: ValidatedUserInfo
): Promise<void> {

	const newUser = db.prepare(
		`INSERT INTO kol_binding (x_id,
								  cdp_user_id,
								  wallet_address,
								  email,
								  username,
								  evm_account_created_at)
		 VALUES (?, ?, ?, ?, ?, ?)`
	).bind(
		userInfo.xSub,
		userInfo.userId,
		userInfo.walletAddress,
		userInfo.email,
		userInfo.username,
		userInfo.walletCreatedAt
	)

	const moveEscrowToRewards = db.prepare(`
		WITH moved AS (
		UPDATE tip_escrow
		SET status     = ${TIP_RECORD_CLAIMED},
			updated_at = CURRENT_TIMESTAMP
		WHERE x_id = ?
		  AND status = ${TIP_RECORD_PENDING} RETURNING amount_atomic
  )
		INSERT
		INTO user_rewards (cdp_user_id, amount_atomic, reason)
		SELECT ?,
			   amount_atomic,
			   'Tips before account creation'

		FROM moved
	`).bind(userInfo.xSub, userInfo.userId);

	await db.batch([newUser, moveEscrowToRewards]);
}

export interface UserReward {
	id: number;
	cdp_user_id: string;
	asset_symbol: string;
	asset_address: string | null;
	amount_atomic: string;
	status: number;
	tx_hash: string | null;
	reason: string | null;
	created_at: string;
	updated_at: string;
}

export interface ValidRewardsResult {
	rewards: UserReward[];
	count: number;
}

/**
 * 查询用户待领取的奖励（status = 0）
 */
export async function queryValidRewards(
	db: D1Database,
	cdpUserId: string
): Promise<ValidRewardsResult> {
	const stmt = db.prepare(
		`SELECT *
		 FROM user_rewards
		 WHERE cdp_user_id = ?
		   AND status = ?
		 ORDER BY created_at DESC`
	).bind(cdpUserId, REWARD_STATUS_PENDING);

	const result = await stmt.all<UserReward>();
	const rewards = result.results || [];

	return {
		rewards,
		count: rewards.length
	};
}

/**
 * 查询用户历史奖励记录（分页）
 */
export async function queryRewardHistory(
	db: D1Database,
	cdpUserId: string,
	status: number = -1,
	pageStart: number = 0,
	pageSize: number = 20
): Promise<{ rewards: UserReward[]; hasMore: boolean }> {
	let sql = `SELECT *
			   FROM user_rewards
			   WHERE cdp_user_id = ?`;
	const params: any[] = [cdpUserId];

	if (status !== -1) {
		sql += ` AND status = ?`;
		params.push(status);
	}

	sql += ` ORDER BY updated_at DESC LIMIT ? OFFSET ?`;
	params.push(pageSize + 1, pageStart);

	const stmt = db.prepare(sql).bind(...params);
	const result = await stmt.all<UserReward>();
	const rewards = result.results || [];

	const hasMore = rewards.length > pageSize;
	if (hasMore) {
		rewards.pop(); // 移除多查询的一条
	}

	return {rewards, hasMore};
}

/**
 * 更新奖励状态
 */
export async function updateRewardStatus(
	db: D1Database,
	id: number,
	status: number,
	txHash?: string
): Promise<void> {
	let sql = "UPDATE user_rewards SET status = ?, updated_at = CURRENT_TIMESTAMP";
	const params: any[] = [status];

	if (txHash) {
		sql += ", tx_hash = ?";
		params.push(txHash);
	}

	sql += " WHERE id = ?";
	params.push(id);

	await db.prepare(sql).bind(...params).run();
}

/**
 * 锁定并获取奖励（原子操作）
 * 将符合条件的奖励从 PENDING 改为 LOCKED 并返回该奖励
 */
export async function lockAndGetReward(
	db: D1Database,
	id: number,
	cdpUserId: string,
	assetSymbol: string = 'USDC'
): Promise<UserReward | null> {
	const result = await db.prepare(
		`UPDATE user_rewards
		 SET status     = ?,
			 updated_at = CURRENT_TIMESTAMP
		 WHERE id = ?
		   AND cdp_user_id = ?
		   AND asset_symbol = ?
		   AND status = ?
		 RETURNING *`
	).bind(
		REWARD_STATUS_LOCKED,
		id,
		cdpUserId,
		assetSymbol.toUpperCase(),
		REWARD_STATUS_PENDING
	).first<UserReward>();

	return result || null;
}
