import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { cronRefundAds } from '../src/cron_ads_refund';

const TEST_ENV = {
    ...env,
};

describe('Ads Refund Cron Tests', () => {

    beforeEach(async () => {
        // Clean up tables
        await env.DB.prepare('DROP TABLE IF EXISTS ad_reward_claims').run();
        await env.DB.prepare('DROP TABLE IF EXISTS ad_campaigns').run();
        await env.DB.prepare('DROP TABLE IF EXISTS ad_escrow_accounts').run();

        // Recreate tables
        await env.DB.prepare(`
			CREATE TABLE ad_escrow_accounts (
				a_x_id TEXT NOT NULL,
				asset_symbol TEXT NOT NULL DEFAULT 'USDC',
				available_atomic TEXT NOT NULL DEFAULT '0',
				frozen_atomic TEXT NOT NULL DEFAULT '0',
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
				quota_claimed INTEGER DEFAULT 0,
				quota_used INTEGER DEFAULT 0,
				status TEXT DEFAULT 'ACTIVE',
                budget_settlement_status TEXT DEFAULT 'NONE',
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
				status TEXT NOT NULL,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
			)
		`).run();
    });

    it('CR-08: Normal refund when ad COMPLETED and no pending claims', async () => {
        const adId = 'ad_cr08';
        const aXId = 'adv_cr08';

        // 1. Setup Ad (Total 10, Used 4, Claimed 4)
        await env.DB.prepare(`
            INSERT INTO ad_campaigns (ad_id, a_x_id, unit_price_atomic, quota_total, quota_claimed, quota_used, status, budget_settlement_status, end_date)
            VALUES (?, ?, '1000000', 10, 4, 4, 'COMPLETED', 'NONE', '2000-01-01 00:00:00')
        `).bind(adId, aXId).run();

        // 2. Setup Escrow (Frozen 6 USDC remaining)
        // Note: Frozen should be (quota_total - quota_used) * unit_price = 6 * 1M = 6M
        await env.DB.prepare('INSERT INTO ad_escrow_accounts (a_x_id, available_atomic, frozen_atomic) VALUES (?, 0, 6000000)').bind(aXId).run();

        // 3. Run Cron
        console.log("--- BEFORE CRON ---");
        const adBefore = await env.DB.prepare('SELECT * FROM ad_campaigns WHERE ad_id = ?').bind(adId).first<any>();
        console.log("Ad Before:", JSON.stringify(adBefore));
        const escrowBefore = await env.DB.prepare('SELECT * FROM ad_escrow_accounts WHERE a_x_id = ?').bind(aXId).first<any>();
        console.log("Escrow Before:", JSON.stringify(escrowBefore));

        await cronRefundAds(TEST_ENV as any);

        console.log("--- AFTER CRON ---");
        const adAfter = await env.DB.prepare('SELECT * FROM ad_campaigns WHERE ad_id = ?').bind(adId).first<any>();
        console.log("Ad After:", JSON.stringify(adAfter));
        const escrowAfter = await env.DB.prepare('SELECT * FROM ad_escrow_accounts WHERE a_x_id = ?').bind(aXId).first<any>();
        console.log("Escrow After:", JSON.stringify(escrowAfter));

        // 4. Verify
        const escrow = await env.DB.prepare('SELECT available_atomic, frozen_atomic FROM ad_escrow_accounts WHERE a_x_id = ?').bind(aXId).first<any>();
        expect(escrow.available_atomic).toBe('6000000');
        expect(escrow.frozen_atomic).toBe('0');

        const ad = await env.DB.prepare('SELECT budget_settlement_status FROM ad_campaigns WHERE ad_id = ?').bind(adId).first<any>();
        expect(ad.budget_settlement_status).toBe('SETTLED');
    });

    it('CR-09: Should SKIP refund if there are PENDING_CONFIRM claims', async () => {
        const adId = 'ad_cr09';
        const aXId = 'adv_cr09';

        await env.DB.prepare(`
            INSERT INTO ad_campaigns (ad_id, a_x_id, unit_price_atomic, quota_total, quota_claimed, quota_used, status, budget_settlement_status, end_date)
            VALUES (?, ?, '1000000', 10, 5, 4, 'EXPIRED', 'NONE', '2000-01-01 00:00:00')
        `).bind(adId, aXId).run();

        // One claim is still pending
        await env.DB.prepare('INSERT INTO ad_reward_claims (claim_id, ad_id, b_x_id, status) VALUES (?, ?, ?, ?)').bind('c1', adId, 'perf1', 'PENDING_CONFIRM').run();

        await env.DB.prepare('INSERT INTO ad_escrow_accounts (a_x_id, available_atomic, frozen_atomic) VALUES (?, 0, 6000000)').bind(aXId).run();

        await cronRefundAds(TEST_ENV as any);

        // Verify NO change
        const escrow = await env.DB.prepare('SELECT available_atomic, frozen_atomic FROM ad_escrow_accounts WHERE a_x_id = ?').bind(aXId).first<any>();
        expect(escrow.available_atomic).toBe('0');
        expect(escrow.frozen_atomic).toBe('6000000');

        const ad = await env.DB.prepare('SELECT budget_settlement_status FROM ad_campaigns WHERE ad_id = ?').bind(adId).first<any>();
        expect(ad.budget_settlement_status).toBe('NONE');
    });

    it('CR-10: Should fail refund if escrow frozen balance is insufficient (anomaly)', async () => {
        const adId = 'ad_cr10';
        const aXId = 'adv_cr10';

        await env.DB.prepare(`
            INSERT INTO ad_campaigns (ad_id, a_x_id, unit_price_atomic, quota_total, quota_claimed, quota_used, status, budget_settlement_status, end_date)
            VALUES (?, ?, '1000000', 10, 4, 4, 'COMPLETED', 'NONE', '2000-01-01 00:00:00')
        `).bind(adId, aXId).run();

        // Frozen balance is UNEXPECTEDLY low (only 1 USDC instead of 6)
        await env.DB.prepare('INSERT INTO ad_escrow_accounts (a_x_id, available_atomic, frozen_atomic) VALUES (?, 0, 1000000)').bind(aXId).run();

        await cronRefundAds(TEST_ENV as any);

        const ad = await env.DB.prepare('SELECT budget_settlement_status FROM ad_campaigns WHERE ad_id = ?').bind(adId).first<any>();
        expect(ad.budget_settlement_status).toBe('NONE'); // Should NOT be SETTLED
    });
});
