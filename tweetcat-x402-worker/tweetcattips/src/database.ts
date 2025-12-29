import {TipMode} from "./common";

export async function getKolBinding(db: D1Database, xId: string): Promise<string | null> {
	const stmt = db.prepare("SELECT wallet_address FROM kol_binding WHERE x_id = ?").bind(xId);
	const row = await stmt.first<{ wallet_address: string }>();
	return row?.wallet_address ?? null;
}

export interface TipRecord {
	xId: string;
	mode: TipMode;
	amountAtomic: string;
	payer: string;
	txHash: string;
}

export async function recordEscrowTips(db: D1Database, params: TipRecord): Promise<string> {
	const id = crypto.randomUUID();

	await db
		.prepare(
			`INSERT INTO tips (id, x_id, mode, amount_atomic, payer, tx_hash, status, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
		)
		.bind(
			id,
			params.xId,
			params.mode,
			params.amountAtomic,
			params.payer,
			params.txHash,
			"pending"
		)
		.run();

	return id
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

	const row = await stmt.first<KolBindingRecord>();
	return row;
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
	await db.prepare(
		`INSERT INTO kol_binding (x_id,
								  cdp_user_id,
								  wallet_address,
								  email,
								  username,
								  evm_account_created_at,
								  signin_time,
								  created_at)
		 VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
	).bind(
		userInfo.xSub,
		userInfo.userId,
		userInfo.walletAddress,
		userInfo.email,
		userInfo.username,
		userInfo.walletCreatedAt
	).run();

}
