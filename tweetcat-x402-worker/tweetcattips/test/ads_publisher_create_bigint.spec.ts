import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerSrv } from '../src/api_srv';
import { app } from '../src/common';

vi.mock('../src/common', async (importOriginal) => {
	const original = await importOriginal<any>();
	return {
		...original,
		signedOperationPaths: [],
		getX402AuthHeader: vi.fn(),
	};
});

vi.mock('../src/api_srv', async (importOriginal) => {
	const original = await importOriginal<any>();
	return {
		...original,
		verifySignatureMiddleware: async (c: any, next: any) => await next(),
	};
});

vi.mock('../src/api_srv_x402', () => {
	return {
		internalTreasurySettle: vi.fn(),
		PaymentRequiredError: class extends Error {
			statusCode = 402;
		},
		x402Workflow: vi.fn(),
		apiHandleTip: vi.fn(),
		apiX402UsdcTransfer: vi.fn(),
		apiTransferByTid: vi.fn(),
	};
});

vi.mock('../src/api_srv_usr', () => {
	return {
		testQueryUserDetails: vi.fn(),
		apiValidateUser: vi.fn(),
		apiQueryValidRewards: vi.fn(),
		apiClaimReward: vi.fn(),
		apiQueryRewardHistory: vi.fn(),
		apiQueryPlatformFees: vi.fn(),
		apiCreateOnrampSession: vi.fn(),
		apiOnrampWebhook: vi.fn(),
	};
});

let routesRegistered = false;

const TEST_ENV = {
	...env,
	TREASURY_ADDRESS: '0x8888888888888888888888888888888888888888',
	TREASURY_PRIVATE_KEY: '0x' + '11'.repeat(32),
	CDP_API_KEY_ID: 'mock_id',
	CDP_API_KEY_SECRET: 'mock_secret',
	CDP_WALLET_SECRET: 'mock_wallet_secret',
	CDP_TREASURY_ACCOUNT_NAME: 'tweetcat-treasury-test',
	REWARD_FOR_SIGNUP: 0.2,
	FEE_FOR_WITHDRAW: 10,
	SETTLEMENT_DELAY_HOURS: 1,
};

describe('Ads Publisher Create BigInt Tests', () => {
	beforeEach(async () => {
		if (!routesRegistered) {
			registerSrv(app);
			routesRegistered = true;
		}

		await env.DB.prepare('DROP TABLE IF EXISTS ads_feed_meta').run();
		await env.DB.prepare('DROP TABLE IF EXISTS ad_campaigns').run();
		await env.DB.prepare('DROP TABLE IF EXISTS ad_escrow_accounts').run();
		await env.DB.prepare('DROP TABLE IF EXISTS kol_binding').run();

		await env.DB.prepare(`
			CREATE TABLE kol_binding (
				x_id TEXT PRIMARY KEY,
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
			CREATE TABLE ad_campaigns (
				ad_id TEXT PRIMARY KEY,
				a_x_id TEXT NOT NULL,
				category TEXT NOT NULL,
				name TEXT NOT NULL,
				title TEXT NOT NULL,
				description TEXT NOT NULL,
				detail_url TEXT NOT NULL,
				image_url TEXT,
				callback_url TEXT,
				custom_data TEXT,
				unit_price_atomic TEXT NOT NULL,
				quota_total INTEGER NOT NULL,
				status TEXT DEFAULT 'ACTIVE',
				end_date DATETIME NOT NULL,
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
			)
		`).run();

		await env.DB.prepare(`
			CREATE TABLE ads_feed_meta (
				id INTEGER PRIMARY KEY,
				version INTEGER NOT NULL,
				updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
			)
		`).run();

		await env.DB.prepare('INSERT INTO kol_binding (x_id) VALUES (?)').bind('a_x_1').run();
	});

	it('P-09: Should handle large quota and high unit price without overflow', async () => {
		const unitPriceAtomic = '10000000';
		const quotaTotal = 1_000_000;
		const requiredAtomic = (BigInt(unitPriceAtomic) * BigInt(quotaTotal)).toString();

		const initialAvailable = (BigInt(requiredAtomic) + 123n).toString();
		await env.DB.prepare(
			"INSERT INTO ad_escrow_accounts (a_x_id, asset_symbol, available_atomic, frozen_atomic) VALUES (?, 'USDC', ?, '0')"
		)
			.bind('a_x_1', initialAvailable)
			.run();

		const res = await app.fetch(
			new Request('http://localhost/ads/publisher/create', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					a_x_id: 'a_x_1',
					name: 'campaign_big_1',
					unit_price_atomic: unitPriceAtomic,
					quota_total: quotaTotal,
					end_date: new Date(Date.now() + 3600 * 1000).toISOString(),
					title: 't',
					description: 'd',
					detail_url: 'https://x.com/a_x_1',
				}),
			}),
			TEST_ENV as any
		);

		const data = (await res.json()) as any;
		expect(res.status).toBe(200);
		expect(data.ok).toBe(true);
		expect(data.required_atomic).toBe(requiredAtomic);

		const balance = await env.DB.prepare(
			"SELECT available_atomic, frozen_atomic FROM ad_escrow_accounts WHERE a_x_id = ? AND asset_symbol = 'USDC'"
		)
			.bind('a_x_1')
			.first<{ available_atomic: string; frozen_atomic: string }>();

		expect(balance?.available_atomic).toBe('123');
		expect(balance?.frozen_atomic).toBe(requiredAtomic);

		const feed = await env.DB.prepare('SELECT version FROM ads_feed_meta WHERE id = 1').first<{ version: number }>();
		expect(Number(feed?.version)).toBe(2);
	});
});

