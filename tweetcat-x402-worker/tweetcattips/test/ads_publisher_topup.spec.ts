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

describe('Ads Publisher TopUp Tests', () => {
	beforeEach(async () => {
		if (!routesRegistered) {
			registerSrv(app);
			routesRegistered = true;
		}

		await env.DB.prepare('DROP TABLE IF EXISTS ads_feed_meta').run();
		await env.DB.prepare('DROP TABLE IF EXISTS ad_campaigns').run();
		await env.DB.prepare('DROP TABLE IF EXISTS ad_escrow_accounts').run();

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
				unit_price_atomic TEXT NOT NULL,
				quota_total INTEGER NOT NULL,
				quota_claimed INTEGER NOT NULL DEFAULT 0,
				quota_used INTEGER NOT NULL DEFAULT 0,
				status TEXT NOT NULL DEFAULT 'ACTIVE',
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
	});

	it('LC-08: Should top up budget for ACTIVE ad and add quota', async () => {
		const aXId = 'a_x_1';
		const adId = 'ad_1';
		const unitPriceAtomic = '100000';
		const topUpAtomic = '5000000';

		await env.DB.prepare(
			"INSERT INTO ad_escrow_accounts (a_x_id, asset_symbol, available_atomic, frozen_atomic) VALUES (?, 'USDC', ?, ?)"
		)
			.bind(aXId, '6000000', '4000000')
			.run();

		await env.DB.prepare(
			"INSERT INTO ad_campaigns (ad_id, a_x_id, unit_price_atomic, quota_total, status, end_date) VALUES (?, ?, ?, ?, 'ACTIVE', datetime('now', '+1 day'))"
		)
			.bind(adId, aXId, unitPriceAtomic, 10)
			.run();

		const res = await app.fetch(
			new Request('http://localhost/ads/publisher/top_up_budget', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ad_id: adId, a_x_id: aXId, amount_atomic: topUpAtomic }),
			}),
			TEST_ENV as any
		);

		const data = (await res.json()) as any;
		expect(res.status).toBe(200);
		expect(data.ok).toBe(true);
		expect(data.ad_id).toBe(adId);
		expect(data.topped_up_atomic).toBe(topUpAtomic);
		expect(data.additional_quota).toBe(50);
		expect(data.new_status).toBe('ACTIVE');

		const updatedAd = await env.DB.prepare('SELECT quota_total FROM ad_campaigns WHERE ad_id = ?')
			.bind(adId)
			.first<{ quota_total: number }>();
		expect(Number(updatedAd?.quota_total)).toBe(60);

		const balance = await env.DB.prepare(
			"SELECT available_atomic, frozen_atomic FROM ad_escrow_accounts WHERE a_x_id = ? AND asset_symbol = 'USDC'"
		)
			.bind(aXId)
			.first<{ available_atomic: string; frozen_atomic: string }>();
		expect(balance?.available_atomic).toBe('1000000');
		expect(balance?.frozen_atomic).toBe('9000000');

		const feed = await env.DB.prepare('SELECT version FROM ads_feed_meta WHERE id = 1').first<{ version: number }>();
		expect(Number(feed?.version)).toBe(2);
	});
});

