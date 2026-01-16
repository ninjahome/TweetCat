import {CURRENCY_SYMBOL_USDC} from "./common";

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


export async function getKolBindingByXId(
	db: D1Database,
	xID: string
): Promise<KolBindingRecord | null> {
	const stmt = db.prepare(
		"SELECT * FROM kol_binding WHERE x_id = ?"
	).bind(xID);

	return await stmt.first<KolBindingRecord>();
}

interface TipRecord {
	xId: string;
	amountAtomic: string;
}

export async function usdcEscrowTips(db: D1Database, params: TipRecord) {
	try {
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
			console.error(`Failed to record tips [${params}]`);
		}
	} catch (err: any) {
		console.error("tip record error:", err, " payment info:", params);
		await logX402Failure(db, {
			kind: "tip_action",
			stage: "record escrow tips",
			context: JSON.stringify(params),
			message: err?.message
		})
	}
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
	// 1. 插入用户信息（增加 OR IGNORE 实现幂等，防止重复回调报错）
	const insertUser = db.prepare(`
		INSERT
		OR IGNORE INTO kol_binding (
      x_id, cdp_user_id, wallet_address, email, username, evm_account_created_at
    ) VALUES (?, ?, ?, ?, ?, ?)
	`).bind(
		userInfo.xSub,
		userInfo.userId,
		userInfo.walletAddress,
		userInfo.email,
		userInfo.username,
		userInfo.walletCreatedAt
	);

	// 2. 将 PENDING 状态的余额搬运到 user_rewards（使用 UPSERT 累加到 status=0 的余额行）
	// 如果不存在 status=0 行则创建，存在则累加金额
	const moveEscrowToRewards = db.prepare(`
		INSERT INTO user_rewards (cdp_user_id, asset_symbol, amount_atomic, status, reason)
		SELECT kb.cdp_user_id,
			   ?,
			   te.amount_atomic,
			   ${REWARD_STATUS_PENDING},
			   'Tips rewards'
		FROM tip_escrow te
				 JOIN kol_binding kb ON kb.x_id = te.x_id
		WHERE te.x_id = ?
		  AND te.status = ? ON CONFLICT(cdp_user_id, asset_symbol)
		WHERE status = ${REWARD_STATUS_PENDING}
			DO
		UPDATE SET
			amount_atomic = CAST (CAST (user_rewards.amount_atomic AS INTEGER) + CAST (excluded.amount_atomic AS INTEGER) AS TEXT),
			updated_at = CURRENT_TIMESTAMP
	`).bind(CURRENCY_SYMBOL_USDC, userInfo.xSub, TIP_RECORD_PENDING);

	// 3. 统一更新状态
	// 注意：即便 moveEscrowToRewards 没找到数据（即没有待领取打赏），这条 UPDATE 也只是执行成功但影响行数为 0，不会报错
	const markAsClaimed = db.prepare(`
		UPDATE tip_escrow
		SET status     = ?,
			updated_at = CURRENT_TIMESTAMP
		WHERE x_id = ?
		  AND status = ?
	`).bind(TIP_RECORD_CLAIMED, userInfo.xSub, TIP_RECORD_PENDING);

	// D1.batch 保证了这三步在同一个事务内
	await db.batch([insertUser, moveEscrowToRewards, markAsClaimed]);
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
}

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
	};
}

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

export async function updateRewardStatus(
	db: D1Database,
	id: number,
	status: number,
	txHash?: string,
	reason?: string
): Promise<void> {
	let sql = "UPDATE user_rewards SET status = ?, updated_at = CURRENT_TIMESTAMP";
	const params: any[] = [status];

	if (txHash) {
		sql += ", tx_hash = ?";
		params.push(txHash);
	}
	if (reason) {
		sql += ", reason = ?";
		params.push(reason);
	}

	sql += " WHERE id = ?";
	params.push(id);

	await db.prepare(sql).bind(...params).run();
}

export async function lockAndGetReward(
	db: D1Database,
	id: number,
	cdpUserId: string,
	assetSymbol: string = CURRENCY_SYMBOL_USDC
): Promise<UserReward | null> {
	const result = await db.prepare(
		`UPDATE user_rewards
		 SET status     = ?,
			 updated_at = CURRENT_TIMESTAMP
		 WHERE id = ?
		   AND cdp_user_id = ?
		   AND asset_symbol = ?
		   AND status = ? RETURNING *`
	).bind(
		REWARD_STATUS_LOCKED,
		id,
		cdpUserId,
		assetSymbol.toUpperCase(),
		REWARD_STATUS_PENDING
	).first<UserReward>();

	return result || null;
}

export interface X402FailureInput {
	kind: string;
	stage: string;
	context?: string;
	message?: string;
	raw?: unknown;
}

const toNull = (v?: string) => (v === undefined ? null : v);

export async function logX402Failure(db: D1Database, input: X402FailureInput): Promise<void> {
	try {
		await db.prepare(
			`INSERT INTO x402_failures (kind, stage, context, message, raw_json)
			 VALUES (?, ?, ?, ?, ?)`
		).bind(
			input.kind,
			input.stage,
			toNull(input.context),
			toNull(input.message),
			(input.raw)
		).run();
	} catch (err: any) {
		console.error("[x402_failures] insert failed:", err?.message || err, {input});
	}
}

/**
 * 将打赏金额累加到用户的余额行（status=0）
 * 如果不存在 status=0 的行则自动创建，存在则累加金额
 * 这是新的打赏累加逻辑，确保始终只有一行 status=0 作为当前余额
 */
export async function creditRewardsBalance(
	db: D1Database,
	cdpUserId: string,
	amountAtomic: string,
	assetSymbol: string = CURRENCY_SYMBOL_USDC,
	reason: string = 'tip rewards'
): Promise<void> {
	try {
		const sql = `
			INSERT INTO user_rewards (cdp_user_id, asset_symbol, amount_atomic, status, reason)
			VALUES (?, ?, ?, ${REWARD_STATUS_PENDING}, ?) ON CONFLICT(cdp_user_id, asset_symbol)
			WHERE status = ${REWARD_STATUS_PENDING}
				DO
			UPDATE SET
				amount_atomic = CAST (CAST (user_rewards.amount_atomic AS INTEGER) + CAST (excluded.amount_atomic AS INTEGER) AS TEXT),
				updated_at = CURRENT_TIMESTAMP
		`;

		const result = await db.prepare(sql)
			.bind(cdpUserId, assetSymbol.toUpperCase(), amountAtomic, reason)
			.run();

		if (!result.success || result.meta.changes === 0) {
			console.error(`Failed to credit rewards balance for user ${cdpUserId}，amount:${amountAtomic}`);
		}
	} catch (err: any) {
		console.error("creditRewardsBalance error:", err, " params:", {cdpUserId, amountAtomic, assetSymbol, reason});
		await logX402Failure(db, {
			kind: "reward_action",
			stage: "credit rewards balance",
			context: JSON.stringify({cdpUserId, amountAtomic, assetSymbol, reason}),
			message: err?.message
		})
	}
}

export interface PlatformFee {
	id: number;
	reward_id: number;
	cdp_user_id: string;
	gross_amount: string;          // 提现原始总额
	fee_rate: number;              // 收费比例（0-100）
	fee_amount: string;            // 平台收取的手续费
	net_amount: string;            // 用户实际到账金额
	asset_symbol: string;
	asset_address: string | null;
	tx_hash: string | null;
	user_wallet_address: string | null;
	platform_wallet_address: string | null;
	status: number;
	reason: string | null;
	created_at: string;
	updated_at: string;
	settled_at: string | null;
}

export interface FeeCalculation {
	grossAmount: string;           // 原始金额（atomic units）
	feeRate: number;               // 收费比例（0-100）
	feeAmount: string;             // 手续费金额（atomic units）
	netAmount: string;             // 净额（atomic units）
}

/**
 * 计算提现手续费
 * @param grossAmount 原始提现金额（atomic units，字符串）
 * @param feeRate 收费比例（0-100 的整数）
 * @returns 包含 gross、fee、net 三个金额的对象
 */
export function calculateWithdrawFee(grossAmount: string, feeRate: number): FeeCalculation {
	if (feeRate < 0 || feeRate > 100) {
		throw new Error(`Invalid fee rate: ${feeRate}. Must be between 0 and 100.`);
	}

	if (!/^\d+$/.test(grossAmount) || grossAmount === "0") {
		throw new Error(`Invalid gross amount: ${grossAmount}`);
	}

	const gross = BigInt(grossAmount);
	const fee = (gross * BigInt(feeRate)) / BigInt(100);
	const net = gross - fee;

	return {
		grossAmount: gross.toString(),
		feeRate,
		feeAmount: fee.toString(),
		netAmount: net.toString()
	};
}

/**
 * 创建平台收费记录
 * @param db D1 数据库实例
 * @param params 收费记录参数
 * @returns 创建的记录 ID
 */
export async function createPlatformFee(
	db: D1Database,
	params: {
		rewardId: number;
		cdpUserId: string;
		grossAmount: string;
		feeRate: number;
		feeAmount: string;
		netAmount: string;
		userWalletAddress: string;
		platformWalletAddress: string;
		tx_hash: string;
	}
): Promise<number> {
	const sql = `
		INSERT INTO platform_fees (reward_id, cdp_user_id, gross_amount,
								   fee_rate, fee_amount, net_amount,
								   user_wallet_address, platform_wallet_address, tx_hash)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id
	`;

	const result = await db.prepare(sql).bind(
		params.rewardId,
		params.cdpUserId,
		params.grossAmount,
		params.feeRate,
		params.feeAmount,
		params.netAmount,
		params.userWalletAddress,
		params.platformWalletAddress,
		params.tx_hash,
	).first<{ id: number }>();

	if (!result) {
		throw new Error("Failed to create platform fee record");
	}

	return result.id;
}

/**
 * 查询用户的收费历史记录
 * @param db D1 数据库实例
 * @param cdpUserId 用户 ID
 * @param pageStart 分页起始
 * @param pageSize 分页大小
 */
export async function queryPlatformFees(
	db: D1Database,
	cdpUserId: string,
	pageStart: number = 0,
	pageSize: number = 20
): Promise<{ fees: PlatformFee[]; hasMore: boolean }> {
	const sql = `
		SELECT *
		FROM platform_fees
		WHERE cdp_user_id = ?
		ORDER BY created_at DESC LIMIT ?
		OFFSET ?
	`;

	const stmt = db.prepare(sql).bind(cdpUserId, pageSize + 1, pageStart);
	const result = await stmt.all<PlatformFee>();
	const fees = result.results || [];

	const hasMore = fees.length > pageSize;
	if (hasMore) {
		fees.pop(); // 移除多查询的一条
	}

	return {fees, hasMore};
}

export async function getPlatformFeesStats(
	db: D1Database,
	cdpUserId: string
): Promise<{ totalFees: string; totalCount: number; avgRate: number }> {
	const sql = `
		SELECT COALESCE(CAST(SUM(CAST(fee_amount AS INTEGER)) AS TEXT), '0') AS total_fees,
			   COALESCE(COUNT(*), 0)                                         AS total_count,
			   COALESCE(AVG(fee_rate), 0)                                    AS avg_rate
		FROM platform_fees
		WHERE cdp_user_id = ?
	`;

	const row = await db.prepare(sql).bind(cdpUserId).first<{
		total_fees: string | null;
		total_count: number | string | null;
		avg_rate: number | string | null;
	}>();

	const totalFees = row?.total_fees ?? "0";

	const totalCount =
		typeof row?.total_count === "string"
			? parseInt(row.total_count, 10) || 0
			: (row?.total_count ?? 0);

	const avgRate =
		typeof row?.avg_rate === "string"
			? parseFloat(row.avg_rate) || 0
			: (row?.avg_rate ?? 0);

	return {totalFees, totalCount, avgRate};
}

// ==================== Onramp Purchase History ====================

export interface OnrampPurchase {
	id: number;
	cdp_user_id: string;
	destination_address: string;
	amount_fiat: string;              // Fiat amount in cents (e.g., "5000" for $50.00)
	amount_crypto: string | null;     // Crypto amount received (atomic units)
	asset: string;                     // e.g., "USDC"
	blockchain: string;                // e.g., "base"
	coinbase_transaction_id: string | null;  // Coinbase's transaction ID
	onramp_session_id: string | null;        // Session ID from Coinbase
	status: string;                    // "pending", "completed", "failed"
	tx_hash: string | null;            // Blockchain transaction hash
	payment_method: string | null;     // "CARD_DEBIT", "APPLE_PAY", etc.
	error_message: string | null;
	created_at: string;
	updated_at: string;
	completed_at: string | null;
}

/**
 * 创建 Onramp 购买记录
 */
export async function createOnrampPurchase(
	db: D1Database,
	params: {
		cdpUserId: string;
		destinationAddress: string;
		amountFiat: string;
		asset: string;
		blockchain: string;
		onrampSessionId?: string;
	}
): Promise<number> {
	const sql = `
		INSERT INTO onramp_purchases (cdp_user_id, destination_address, amount_fiat,
									  asset, blockchain, onramp_session_id, status)
		VALUES (?, ?, ?, ?, ?, ?, 'pending') RETURNING id
	`;

	const result = await db.prepare(sql).bind(
		params.cdpUserId,
		params.destinationAddress,
		params.amountFiat,
		params.asset,
		params.blockchain,
		params.onrampSessionId || null
	).first<{ id: number }>();

	if (!result) {
		throw new Error("Failed to create onramp purchase record");
	}

	return result.id;
}

/**
 * 更新 Onramp 购买记录状态（用于 Webhook）
 */
export async function updateOnrampPurchaseStatus(
	db: D1Database,
	coinbaseTransactionId: string,
	updates: {
		status?: string;
		amountCrypto?: string;
		txHash?: string;
		paymentMethod?: string;
		errorMessage?: string;
	}
): Promise<void> {
	let sql = "UPDATE onramp_purchases SET updated_at = CURRENT_TIMESTAMP";
	const params: any[] = [];

	if (updates.status) {
		sql += ", status = ?";
		params.push(updates.status);
		if (updates.status === "completed") {
			sql += ", completed_at = CURRENT_TIMESTAMP";
		}
	}

	if (updates.amountCrypto) {
		sql += ", amount_crypto = ?";
		params.push(updates.amountCrypto);
	}

	if (updates.txHash) {
		sql += ", tx_hash = ?";
		params.push(updates.txHash);
	}

	if (updates.paymentMethod) {
		sql += ", payment_method = ?";
		params.push(updates.paymentMethod);
	}

	if (updates.errorMessage) {
		sql += ", error_message = ?";
		params.push(updates.errorMessage);
	}

	sql += " WHERE coinbase_transaction_id = ?";
	params.push(coinbaseTransactionId);

	await db.prepare(sql).bind(...params).run();
}

/**
 * 查询用户的 Onramp 购买历史
 */
export async function queryOnrampPurchases(
	db: D1Database,
	cdpUserId: string,
	pageStart: number = 0,
	pageSize: number = 20
): Promise<{ purchases: OnrampPurchase[]; hasMore: boolean }> {
	const sql = `
		SELECT *
		FROM onramp_purchases
		WHERE cdp_user_id = ?
		ORDER BY created_at DESC LIMIT ?
		OFFSET ?
	`;

	const stmt = db.prepare(sql).bind(cdpUserId, pageSize + 1, pageStart);
	const result = await stmt.all<OnrampPurchase>();
	const purchases = result.results || [];

	const hasMore = purchases.length > pageSize;
	if (hasMore) {
		purchases.pop();
	}

	return {purchases, hasMore};
}
