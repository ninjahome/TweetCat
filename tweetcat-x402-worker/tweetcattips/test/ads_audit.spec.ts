import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

function bigIntFromRowValue(v: unknown): bigint {
	if (v === null || v === undefined) return 0n;
	if (typeof v === 'bigint') return v;
	if (typeof v === 'number') return BigInt(Math.trunc(v));
	if (typeof v === 'string' && v.trim() !== '') return BigInt(v);
	return 0n;
}

async function sumAtomic(db: D1Database, sql: string, binds: unknown[] = []): Promise<bigint> {
	const row = await db.prepare(sql).bind(...binds).first<{ sum_atomic: unknown }>();
	return bigIntFromRowValue(row?.sum_atomic);
}

describe('Ads Audit Tests', () => {
	beforeEach(async () => {
		await env.DB.prepare('DROP TABLE IF EXISTS ad_performer_ledger').run();
		await env.DB.prepare('DROP TABLE IF EXISTS ad_performer_accounts').run();
		await env.DB.prepare('DROP TABLE IF EXISTS ad_claim_evidence').run();
		await env.DB.prepare('DROP TABLE IF EXISTS ad_reward_claims').run();
		await env.DB.prepare('DROP TABLE IF EXISTS ad_campaigns').run();
		await env.DB.prepare('DROP TABLE IF EXISTS ad_escrow_ledger').run();
		await env.DB.prepare('DROP TABLE IF EXISTS ad_escrow_accounts').run();
		await env.DB.prepare('DROP TABLE IF EXISTS kol_binding').run();

		await env.DB.prepare(`
			CREATE TABLE kol_binding (
				x_id TEXT PRIMARY KEY,
				cdp_user_id TEXT UNIQUE,
				wallet_address TEXT,
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP
			)
		`).run();

		await env.DB.prepare(`
			CREATE TABLE ad_escrow_accounts (
				a_x_id TEXT NOT NULL,
				asset_symbol TEXT NOT NULL DEFAULT 'USDC',
				available_atomic TEXT NOT NULL DEFAULT '0',
				frozen_atomic TEXT NOT NULL DEFAULT '0',
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				PRIMARY KEY (a_x_id, asset_symbol)
			)
		`).run();

		await env.DB.prepare(`
			CREATE TABLE ad_escrow_ledger (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				ledger_id TEXT,
				a_x_id TEXT NOT NULL,
				direction TEXT NOT NULL,
				asset_symbol TEXT NOT NULL DEFAULT 'USDC',
				amount_atomic TEXT NOT NULL,
				receiver_address TEXT,
				payer_address TEXT,
				tx_hash TEXT UNIQUE,
				status TEXT NOT NULL DEFAULT 'PENDING',
				request_id TEXT,
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
			)
		`).run();

		await env.DB.prepare(`
			CREATE TABLE ad_campaigns (
				ad_id TEXT PRIMARY KEY,
				a_x_id TEXT NOT NULL,
				unit_price_atomic TEXT NOT NULL,
				quota_total INTEGER NOT NULL,
				quota_claimed INTEGER DEFAULT 0,
				quota_used INTEGER DEFAULT 0,
				status TEXT DEFAULT 'ACTIVE',
				budget_settlement_status TEXT NOT NULL DEFAULT 'NONE',
				end_date DATETIME NOT NULL,
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
			)
		`).run();

		await env.DB.prepare(`
			CREATE TABLE ad_reward_claims (
				claim_id TEXT PRIMARY KEY,
				ad_id TEXT NOT NULL,
				b_x_id TEXT NOT NULL,
				b_wallet TEXT,
				status TEXT NOT NULL,
				unit_price_atomic TEXT,
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				UNIQUE (ad_id, b_x_id)
			)
		`).run();

		await env.DB.prepare(`
			CREATE TABLE ad_performer_accounts (
				b_x_id TEXT NOT NULL,
				asset_symbol TEXT NOT NULL DEFAULT 'USDC',
				available_atomic TEXT NOT NULL DEFAULT '0',
				withdrawn_atomic TEXT NOT NULL DEFAULT '0',
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				PRIMARY KEY (b_x_id, asset_symbol)
			)
		`).run();

		await env.DB.prepare(`
			CREATE TABLE ad_performer_ledger (
				ledger_id TEXT PRIMARY KEY,
				b_x_id TEXT NOT NULL,
				asset_symbol TEXT NOT NULL DEFAULT 'USDC',
				amount_atomic TEXT NOT NULL,
				receiver_address TEXT,
				status TEXT NOT NULL DEFAULT 'PENDING',
				request_id TEXT,
				tx_hash TEXT,
				payer_address TEXT,
				error_reason TEXT,
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
			)
		`).run();
	});

	it('E2E-10: Ledger invariants hold for advertiser and performer', async () => {
		const aXId = 'tc_audit_axid';
		const bXId = 'tc_audit_bxid';
		const adId = 'tc_audit_adid';

		await env.DB.prepare('INSERT INTO kol_binding (x_id, wallet_address) VALUES (?, ?)').bind(aXId, '0xaaa').run();
		await env.DB.prepare('INSERT INTO kol_binding (x_id, wallet_address) VALUES (?, ?)').bind(bXId, '0xbbb').run();

		await env.DB.prepare(
			'INSERT INTO ad_escrow_ledger (ledger_id, a_x_id, direction, amount_atomic, status) VALUES (?, ?, ?, ?, ?)'
		)
			.bind('l_dep_1', aXId, 'DEPOSIT', '10000000', 'SETTLED')
			.run();

		await env.DB.prepare(
			'INSERT INTO ad_campaigns (ad_id, a_x_id, unit_price_atomic, quota_total, quota_claimed, quota_used, status, end_date) VALUES (?, ?, ?, ?, ?, ?, ?, datetime(\'now\'))'
		)
			.bind(adId, aXId, '2000000', 3, 2, 2, 'COMPLETED')
			.run();

		await env.DB.prepare(
			'INSERT INTO ad_reward_claims (claim_id, ad_id, b_x_id, status, unit_price_atomic) VALUES (?, ?, ?, ?, ?)'
		)
			.bind('c1', adId, bXId, 'CONFIRMED', '2000000')
			.run();
		await env.DB.prepare(
			'INSERT INTO ad_reward_claims (claim_id, ad_id, b_x_id, status, unit_price_atomic) VALUES (?, ?, ?, ?, ?)'
		)
			.bind('c2', adId, 'tc_audit_bxid_2', 'CONFIRMED', '2000000')
			.run();

		await env.DB.prepare(
			'INSERT INTO ad_escrow_accounts (a_x_id, available_atomic, frozen_atomic) VALUES (?, ?, ?)'
		)
			.bind(aXId, '4000000', '2000000')
			.run();

		await env.DB.prepare(
			'INSERT INTO ad_performer_accounts (b_x_id, available_atomic, withdrawn_atomic) VALUES (?, ?, ?)'
		)
			.bind(bXId, '1000000', '1000000')
			.run();

		await env.DB.prepare(
			'INSERT INTO ad_performer_ledger (ledger_id, b_x_id, amount_atomic, status) VALUES (?, ?, ?, ?)'
		)
			.bind('pl1', bXId, '1000000', 'SETTLED')
			.run();

		const aBalance = await env.DB.prepare(
			"SELECT available_atomic, frozen_atomic FROM ad_escrow_accounts WHERE a_x_id = ? AND asset_symbol = 'USDC'"
		)
			.bind(aXId)
			.first<{ available_atomic: string; frozen_atomic: string }>();

		const advertiserTotal = BigInt(aBalance?.available_atomic ?? '0') + BigInt(aBalance?.frozen_atomic ?? '0');

		const deposits = await sumAtomic(
			env.DB,
			"SELECT COALESCE(SUM(CAST(amount_atomic AS INTEGER)), 0) AS sum_atomic FROM ad_escrow_ledger WHERE a_x_id = ? AND direction = 'DEPOSIT' AND status = 'SETTLED'",
			[aXId]
		);
		const withdrawals = await sumAtomic(
			env.DB,
			"SELECT COALESCE(SUM(CAST(amount_atomic AS INTEGER)), 0) AS sum_atomic FROM ad_escrow_ledger WHERE a_x_id = ? AND direction = 'WITHDRAW' AND status = 'SETTLED'",
			[aXId]
		);
		const confirmedSpend = await sumAtomic(
			env.DB,
			`
				SELECT COALESCE(SUM(CAST(rc.unit_price_atomic AS INTEGER)), 0) AS sum_atomic
				FROM ad_reward_claims rc
				JOIN ad_campaigns ac ON ac.ad_id = rc.ad_id
				WHERE ac.a_x_id = ?
				  AND rc.status = 'CONFIRMED'
			`,
			[aXId]
		);

		expect(advertiserTotal).toBe(deposits - withdrawals - confirmedSpend);

		const performerBalance = await env.DB.prepare(
			"SELECT available_atomic FROM ad_performer_accounts WHERE b_x_id = ? AND asset_symbol = 'USDC'"
		)
			.bind(bXId)
			.first<{ available_atomic: string }>();
		const performerAvailable = BigInt(performerBalance?.available_atomic ?? '0');

		const performerConfirmed = await sumAtomic(
			env.DB,
			"SELECT COALESCE(SUM(CAST(unit_price_atomic AS INTEGER)), 0) AS sum_atomic FROM ad_reward_claims WHERE b_x_id = ? AND status = 'CONFIRMED'",
			[bXId]
		);
		const performerWithdrawals = await sumAtomic(
			env.DB,
			"SELECT COALESCE(SUM(CAST(amount_atomic AS INTEGER)), 0) AS sum_atomic FROM ad_performer_ledger WHERE b_x_id = ? AND status = 'SETTLED'",
			[bXId]
		);

		expect(performerAvailable).toBe(performerConfirmed - performerWithdrawals);
	});
});
