import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { cronSettleAds } from '../src/cron_ads_settle';

const TEST_ENV = {
    ...env,
    SETTLEMENT_DELAY_HOURS: 1,
};

describe('Ads Settlement Cron Tests', () => {

    beforeEach(async () => {
        // Clean up tables
        await env.DB.prepare('DROP TABLE IF EXISTS ad_claim_evidence').run();
        await env.DB.prepare('DROP TABLE IF EXISTS ad_reward_claims').run();
        await env.DB.prepare('DROP TABLE IF EXISTS ad_campaigns').run();
        await env.DB.prepare('DROP TABLE IF EXISTS ad_escrow_accounts').run();
        await env.DB.prepare('DROP TABLE IF EXISTS ad_performer_accounts').run();

        // Recreate tables (Minimal versions needed for test)
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
				quota_claimed INTEGER DEFAULT 0,
				quota_used INTEGER DEFAULT 0,
				status TEXT DEFAULT 'ACTIVE',
                detail_url TEXT,
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
				signature TEXT,
				proof TEXT,
                verification_notes TEXT,
                verified_at DATETIME,
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				UNIQUE (ad_id, b_x_id)
			)
		`).run();

        await env.DB.prepare(`
			CREATE TABLE ad_claim_evidence (
				evidence_id TEXT PRIMARY KEY,
				claim_id TEXT NOT NULL,
				ad_id TEXT NOT NULL,
				b_x_id TEXT NOT NULL,
				category TEXT,
				proof_type TEXT,
				proof_data TEXT,
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
    });

    it('CR-01: PENDING_CONFIRM > 1h, following=true - Should CONFIRM', async () => {
        const adId = 'ad_cr01';
        const aXId = 'adv_cr01';
        const bXId = 'perf_cr01';
        const claimId = 'claim_cr01';

        // 1. Setup Ad
        await env.DB.prepare(`
            INSERT INTO ad_campaigns (ad_id, a_x_id, unit_price_atomic, quota_total, quota_claimed, status, detail_url, end_date)
            VALUES (?, ?, '1000000', 10, 1, 'ACTIVE', 'https://x.com/target', '2099-01-01 00:00:00')
        `).bind(adId, aXId).run();

        // 2. Setup Escrow with balance
        await env.DB.prepare('INSERT INTO ad_escrow_accounts (a_x_id, frozen_atomic) VALUES (?, 10000000)').bind(aXId).run();

        // 3. Setup Claim
        await env.DB.prepare(`
            INSERT INTO ad_reward_claims (claim_id, ad_id, b_x_id, status, unit_price_atomic, updated_at)
            VALUES (?, ?, ?, 'PENDING_CONFIRM', '1000000', datetime('now', '-2 hours'))
        `).bind(claimId, adId, bXId).run();

        // 4. Setup Evidence (following=true)
        const okProof = JSON.stringify({
            data: {
                user_result_by_screen_name: {
                    result: {
                        legacy: { screen_name: 'target' },
                        relationship_perspectives: { following: true }
                    }
                }
            }
        });
        await env.DB.prepare(`
            INSERT INTO ad_claim_evidence (evidence_id, claim_id, ad_id, b_x_id, category, proof_type, proof_data)
            VALUES (?, ?, ?, ?, 'follow', 'twitter_profile_spotlight', ?)
        `).bind('ev_cr01', claimId, adId, bXId, okProof).run();

        // 5. Run Cron
        await cronSettleAds(TEST_ENV as any);

        // 6. Verify
        const claim = await env.DB.prepare('SELECT status FROM ad_reward_claims WHERE claim_id = ?').bind(claimId).first<any>();
        expect(claim.status).toBe('CONFIRMED');

        const perfAcc = await env.DB.prepare('SELECT available_atomic FROM ad_performer_accounts WHERE b_x_id = ?').bind(bXId).first<any>();
        expect(perfAcc.available_atomic).toBe('1000000');

        const ad = await env.DB.prepare('SELECT quota_used FROM ad_campaigns WHERE ad_id = ?').bind(adId).first<any>();
        expect(ad.quota_used).toBe(1);
    });

    it('CR-02: PENDING_CONFIRM > 1h, following=false - Should REJECT', async () => {
        const adId = 'ad_cr02';
        const aXId = 'adv_cr02';
        const bXId = 'perf_cr02';
        const claimId = 'claim_cr02';

        await env.DB.prepare(`
            INSERT INTO ad_campaigns (ad_id, a_x_id, unit_price_atomic, quota_total, quota_claimed, status, detail_url, end_date)
            VALUES (?, ?, '1000000', 10, 1, 'ACTIVE', 'https://x.com/target', '2099-01-01 00:00:00')
        `).bind(adId, aXId).run();

        await env.DB.prepare(`
            INSERT INTO ad_reward_claims (claim_id, ad_id, b_x_id, status, unit_price_atomic, updated_at)
            VALUES (?, ?, ?, 'PENDING_CONFIRM', '1000000', datetime('now', '-2 hours'))
        `).bind(claimId, adId, bXId).run();

        // following=false
        const badProof = JSON.stringify({
            data: {
                user_result_by_screen_name: {
                    result: {
                        legacy: { screen_name: 'target' },
                        relationship_perspectives: { following: false }
                    }
                }
            }
        });
        await env.DB.prepare(`
            INSERT INTO ad_claim_evidence (evidence_id, claim_id, ad_id, b_x_id, category, proof_type, proof_data)
            VALUES (?, ?, ?, ?, 'follow', 'twitter_profile_spotlight', ?)
        `).bind('ev_cr02', claimId, adId, bXId, badProof).run();

        await cronSettleAds(TEST_ENV as any);

        const claim = await env.DB.prepare('SELECT status, verification_notes FROM ad_reward_claims WHERE claim_id = ?').bind(claimId).first<any>();
        expect(claim.status).toBe('REJECTED');
        expect(claim.verification_notes).toBe('Twitter API indicates not following');

        // Verify quota_claimed released
        const ad = await env.DB.prepare('SELECT quota_claimed FROM ad_campaigns WHERE ad_id = ?').bind(adId).first<any>();
        expect(ad.quota_claimed).toBe(0);
    });

    it('CR-03: PENDING_CONFIRM > 1h, Missing proof data - Should REJECT', async () => {
        const adId = 'ad_cr03';
        const aXId = 'adv_cr03';
        const bXId = 'perf_cr03';
        const claimId = 'claim_cr03';

        // 1. Setup Ad
        await env.DB.prepare(`
            INSERT INTO ad_campaigns (ad_id, a_x_id, unit_price_atomic, quota_total, quota_claimed, status, detail_url, end_date)
            VALUES (?, ?, '1000000', 10, 1, 'ACTIVE', 'https://x.com/target', '2099-01-01 00:00:00')
        `).bind(adId, aXId).run();

        // 2. Setup Claim (PENDING_CONFIRM with old updated_at)
        await env.DB.prepare(`
            INSERT INTO ad_reward_claims (claim_id, ad_id, b_x_id, status, unit_price_atomic, updated_at)
            VALUES (?, ?, ?, 'PENDING_CONFIRM', '1000000', datetime('now', '-2 hours'))
        `).bind(claimId, adId, bXId).run();

        // 3. Setup Evidence with MISSING proof_data (null)
        await env.DB.prepare(`
            INSERT INTO ad_claim_evidence (evidence_id, claim_id, ad_id, b_x_id, category, proof_type, proof_data)
            VALUES (?, ?, ?, ?, 'follow', 'twitter_profile_spotlight', NULL)
        `).bind('ev_cr03', claimId, adId, bXId).run();

        // 4. Run Cron
        await cronSettleAds(TEST_ENV as any);

        // 5. Verify
        const claim = await env.DB.prepare('SELECT status, verification_notes FROM ad_reward_claims WHERE claim_id = ?').bind(claimId).first<any>();
        expect(claim.status).toBe('REJECTED');
        expect(claim.verification_notes).toBe('Missing proof data');

        // Verify quota_claimed was released (1 -> 0)
        const ad = await env.DB.prepare('SELECT quota_claimed FROM ad_campaigns WHERE ad_id = ?').bind(adId).first<any>();
        expect(ad.quota_claimed).toBe(0);
    });

    it('CR-04: Unsupported proof type - Should REJECT', async () => {
        const adId = 'ad_cr04';
        const claimId = 'claim_cr04';

        await env.DB.prepare(`
            INSERT INTO ad_campaigns (ad_id, a_x_id, unit_price_atomic, quota_total, quota_claimed, status, end_date)
            VALUES (?, 'adv_1', '1000000', 10, 1, 'ACTIVE', '2099-01-01 00:00:00')
        `).bind(adId).run();

        await env.DB.prepare(`
            INSERT INTO ad_reward_claims (claim_id, ad_id, b_x_id, status, unit_price_atomic, updated_at)
            VALUES (?, ?, 'perf_1', 'PENDING_CONFIRM', '1000000', datetime('now', '-2 hours'))
        `).bind(claimId, adId).run();

        await env.DB.prepare(`
            INSERT INTO ad_claim_evidence (evidence_id, claim_id, ad_id, b_x_id, category, proof_type, proof_data)
            VALUES (?, ?, ?, 'perf_1', 'follow', 'weird_type', '{"some":"data"}')
        `).bind('ev_cr04', claimId, adId).run();

        await cronSettleAds(TEST_ENV as any);

        const claim = await env.DB.prepare('SELECT status, verification_notes FROM ad_reward_claims WHERE claim_id = ?').bind(claimId).first<any>();
        expect(claim.status).toBe('REJECTED');
        expect(claim.verification_notes).toBe('Unsupported proof type: weird_type');
    });

    it('CR-05: Malformed proof JSON - Should REJECT', async () => {
        const adId = 'ad_cr05';
        const claimId = 'claim_cr05';

        await env.DB.prepare(`
            INSERT INTO ad_campaigns (ad_id, a_x_id, unit_price_atomic, quota_total, quota_claimed, status, end_date)
            VALUES (?, 'adv_1', '1000000', 10, 1, 'ACTIVE', '2099-01-01 00:00:00')
        `).bind(adId).run();

        await env.DB.prepare(`
            INSERT INTO ad_reward_claims (claim_id, ad_id, b_x_id, status, unit_price_atomic, updated_at)
            VALUES (?, ?, 'perf_1', 'PENDING_CONFIRM', '1000000', datetime('now', '-2 hours'))
        `).bind(claimId, adId).run();

        await env.DB.prepare(`
            INSERT INTO ad_claim_evidence (evidence_id, claim_id, ad_id, b_x_id, category, proof_type, proof_data)
            VALUES (?, ?, ?, 'perf_1', 'follow', 'twitter_profile_spotlight', '{invalid-json}')
        `).bind('ev_cr05', claimId, adId).run();

        await cronSettleAds(TEST_ENV as any);

        const claim = await env.DB.prepare('SELECT status, verification_notes FROM ad_reward_claims WHERE claim_id = ?').bind(claimId).first<any>();
        expect(claim.status).toBe('REJECTED');
        expect(claim.verification_notes).toBe('Malformed proof JSON');
    });

    it('CR-06: Insufficient frozen balance - Should FAIL and stay PENDING_CONFIRM', async () => {
        const adId = 'ad_cr06';
        const aXId = 'adv_cr06';
        const claimId = 'claim_cr06';

        await env.DB.prepare(`
            INSERT INTO ad_campaigns (ad_id, a_x_id, unit_price_atomic, quota_total, quota_claimed, status, detail_url, end_date)
            VALUES (?, ?, '1000000', 10, 1, 'ACTIVE', 'https://x.com/target', '2099-01-01 00:00:00')
        `).bind(adId, aXId).run();

        // NO frozen balance in escrow account for this advertiser
        await env.DB.prepare('INSERT INTO ad_escrow_accounts (a_x_id, frozen_atomic) VALUES (?, 0)').bind(aXId).run();

        await env.DB.prepare(`
            INSERT INTO ad_reward_claims (claim_id, ad_id, b_x_id, status, unit_price_atomic, updated_at)
            VALUES (?, ?, 'perf_1', 'PENDING_CONFIRM', '1000000', datetime('now', '-2 hours'))
        `).bind(claimId, adId).run();

        // Valid proof data
        const okProof = JSON.stringify({
            data: {
                user_result_by_screen_name: {
                    result: {
                        legacy: { screen_name: 'target' },
                        relationship_perspectives: { following: true }
                    }
                }
            }
        });
        await env.DB.prepare(`
            INSERT INTO ad_claim_evidence (evidence_id, claim_id, ad_id, b_x_id, category, proof_type, proof_data)
            VALUES (?, ?, ?, 'perf_1', 'follow', 'twitter_profile_spotlight', ?)
        `).bind('ev_cr06', claimId, adId, okProof).run();

        const escrowBefore = await env.DB.prepare('SELECT * FROM ad_escrow_accounts WHERE a_x_id = ?').bind(aXId).first<any>();
        console.log('DEBUG CR-06: Escrow before cron:', escrowBefore);

        await cronSettleAds(TEST_ENV as any);

        const escrowAfter = await env.DB.prepare('SELECT * FROM ad_escrow_accounts WHERE a_x_id = ?').bind(aXId).first<any>();
        console.log('DEBUG CR-06: Escrow after cron:', escrowAfter);

        const claim = await env.DB.prepare('SELECT status FROM ad_reward_claims WHERE claim_id = ?').bind(claimId).first<any>();
        // Should STILL be PENDING_CONFIRM because settlement failed (insufficient balance)
        expect(claim.status).toBe('PENDING_CONFIRM');
    });

    it('CR-07: Batch processing - Should process multiple independently', async () => {
        const adId = 'ad_cr07';
        const aXId = 'adv_cr07';

        await env.DB.prepare(`
            INSERT INTO ad_campaigns (ad_id, a_x_id, unit_price_atomic, quota_total, quota_claimed, status, detail_url, end_date)
            VALUES (?, ?, '1000000', 10, 2, 'ACTIVE', 'https://x.com/target', '2099-01-01 00:00:00')
        `).bind(adId, aXId).run();

        await env.DB.prepare('INSERT INTO ad_escrow_accounts (a_x_id, frozen_atomic) VALUES (?, 10000000)').bind(aXId).run();

        // Claim 1: Valid proof -> Should be CONFIRMED
        const c1 = 'claim_cr07_1';
        await env.DB.prepare(`
            INSERT INTO ad_reward_claims (claim_id, ad_id, b_x_id, status, unit_price_atomic, updated_at)
            VALUES (?, ?, 'p1', 'PENDING_CONFIRM', '1000000', datetime('now', '-2 hours'))
        `).bind(c1, adId).run();
        const okProof = JSON.stringify({
            data: {
                user_result_by_screen_name: {
                    result: {
                        legacy: { screen_name: 'target' },
                        relationship_perspectives: { following: true }
                    }
                }
            }
        });
        await env.DB.prepare(`
            INSERT INTO ad_claim_evidence (evidence_id, claim_id, ad_id, b_x_id, category, proof_type, proof_data)
            VALUES (?, ?, ?, 'p1', 'follow', 'twitter_profile_spotlight', ?)
        `).bind('ev1', c1, adId, okProof).run();

        // Claim 2: Invalid proof -> Should be REJECTED
        const c2 = 'claim_cr07_2';
        await env.DB.prepare(`
            INSERT INTO ad_reward_claims (claim_id, ad_id, b_x_id, status, unit_price_atomic, updated_at)
            VALUES (?, ?, 'p2', 'PENDING_CONFIRM', '1000000', datetime('now', '-2 hours'))
        `).bind(c2, adId).run();
        await env.DB.prepare(`
            INSERT INTO ad_claim_evidence (evidence_id, claim_id, ad_id, b_x_id, category, proof_type, proof_data)
            VALUES (?, ?, ?, 'p2', 'follow', 'twitter_profile_spotlight', NULL)
        `).bind('ev2', c2, adId).run();

        const escrow = await env.DB.prepare('SELECT * FROM ad_escrow_accounts WHERE a_x_id = ?').bind(aXId).first<any>();
        console.log('DEBUG: Escrow before cron:', escrow);

        await cronSettleAds(TEST_ENV as any);

        const r1 = await env.DB.prepare('SELECT status FROM ad_reward_claims WHERE claim_id = ?').bind(c1).first<any>();
        const r2 = await env.DB.prepare('SELECT status FROM ad_reward_claims WHERE claim_id = ?').bind(c2).first<any>();

        expect(r1.status).toBe('CONFIRMED');
        expect(r2.status).toBe('REJECTED');
    });
});
