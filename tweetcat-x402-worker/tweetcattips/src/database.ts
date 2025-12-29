export const TIP_RECORD_PENDING = 0
export const TIP_RECORD_CLAIMED = 10
export type TIP_STATUS = typeof TIP_RECORD_PENDING | typeof TIP_RECORD_CLAIMED

export const REWARD_STATUS_PENDING = 0
export const REWARD_STATUS_LOCKED = 10
export const REWARD_STATUS_PROCESSING = 20
export const REWARD_STATUS_SUCCESS = 30
export const REWARD_STATUS_FAILED = 40
export const REWARD_STATUS_CANCELLED = 50

export type REWARD_STATUS =
	typeof REWARD_STATUS_PENDING
	| typeof REWARD_STATUS_LOCKED
	| typeof REWARD_STATUS_PROCESSING
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
