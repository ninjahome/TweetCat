import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/common';
import { registerSrv } from '../src/api_srv';

const TEST_ENV = { ...env };

// Mock common BEFORE anything else uses it
vi.mock('../src/common', async (importOriginal) => {
    const original = await importOriginal<any>();
    return {
        ...original,
        signedOperationPaths: [], // Disable path-based signature requirement
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

describe('Ads Concurrency & Race Condition Tests', () => {
    let routesRegistered = false;

    beforeEach(async () => {
        if (!routesRegistered) {
            registerSrv(app);
            routesRegistered = true;
        }
        await env.DB.prepare('DROP TABLE IF EXISTS ad_reward_claims').run();
        await env.DB.prepare('DROP TABLE IF EXISTS ad_claim_evidence').run();
        await env.DB.prepare('DROP TABLE IF EXISTS ad_campaigns').run();
        await env.DB.prepare('DROP TABLE IF EXISTS ad_escrow_accounts').run();
        await env.DB.prepare('DROP TABLE IF EXISTS kol_binding').run();
        await env.DB.prepare('DROP TABLE IF EXISTS ads_feed_meta').run();

        await env.DB.prepare(`
            CREATE TABLE kol_binding (
                x_id TEXT PRIMARY KEY,
                cdp_user_id TEXT UNIQUE,
                wallet_address TEXT,
                device_pubkey_spki TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `).run();

        await env.DB.prepare(`
            CREATE TABLE ad_campaigns (
                ad_id TEXT PRIMARY KEY,
                a_x_id TEXT NOT NULL,
                category TEXT NOT NULL DEFAULT 'follow',
                name TEXT NOT NULL DEFAULT '',
                title TEXT NOT NULL DEFAULT '',
                description TEXT NOT NULL DEFAULT '',
                detail_url TEXT NOT NULL DEFAULT '',
                unit_price_atomic TEXT NOT NULL,
                quota_total INTEGER NOT NULL,
                quota_claimed INTEGER DEFAULT 0,
                quota_used INTEGER DEFAULT 0,
                status TEXT DEFAULT 'ACTIVE',
                end_date DATETIME NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `).run();

        await env.DB.prepare(`
            CREATE TABLE ads_feed_meta (
                id INTEGER PRIMARY KEY,
                version INTEGER NOT NULL DEFAULT 1,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                CHECK (id = 1)
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
            CREATE TABLE ad_claim_evidence (
                evidence_id TEXT PRIMARY KEY,
                claim_id TEXT NOT NULL,
                ad_id TEXT NOT NULL,
                b_x_id TEXT NOT NULL,
                category TEXT,
                proof_type TEXT,
                proof_data TEXT,
                observed_data TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `).run();
    });

    /**
     * E-01: Sequential claim test for last quota.
     *
     * Verifies: `incrementAdClaimedQuota` uses `WHERE quota_claimed < quota_total`
     * so the second user's claim will fail with QUOTA_FULL once the first user has taken
     * the last slot.
     */
    it('E-01: Second user should get QUOTA_FULL when the last quota is already taken', async () => {
        const adId = 'ad_last_quota';
        await env.DB.prepare(`
            INSERT INTO ad_campaigns (ad_id, a_x_id, unit_price_atomic, quota_total, quota_claimed, status, detail_url, end_date)
            VALUES (?, 'adv_1', '1000000', 1, 0, 'ACTIVE', 'https://x.com/target', '2099-01-01 00:00:00')
        `).bind(adId).run();

        // Use whitelist IDs to bypass Blue V check
        const userA = '1899045104146644992';
        const userB = '1735224873365225472';
        await env.DB.prepare('INSERT INTO kol_binding (x_id, cdp_user_id) VALUES (?, ?)').bind(userA, 'cdp_a').run();
        await env.DB.prepare('INSERT INTO kol_binding (x_id, cdp_user_id) VALUES (?, ?)').bind(userB, 'cdp_b').run();

        // First user claims successfully
        const res1 = await app.fetch(new Request('http://localhost/ads/executor/claim', {
            method: 'POST',
            body: JSON.stringify({
                ad_id: adId, b_x_id: userA, b_wallet: '0xwA',
                proof_data: { following: true }, proof_type: 'twitter_profile_spotlight', category: 'follow'
            })
        }), TEST_ENV as any);
        const data1 = await res1.json<any>();
        expect(data1.success).toBe(true);

        // Second user should be blocked
        const res2 = await app.fetch(new Request('http://localhost/ads/executor/claim', {
            method: 'POST',
            body: JSON.stringify({
                ad_id: adId, b_x_id: userB, b_wallet: '0xwB',
                proof_data: { following: true }, proof_type: 'twitter_profile_spotlight', category: 'follow'
            })
        }), TEST_ENV as any);
        const data2 = await res2.json<any>();
        expect(data2.error).toBe('QUOTA_FULL');

        // Verify quota_claimed is 1
        const ad = await env.DB.prepare('SELECT quota_claimed FROM ad_campaigns WHERE ad_id = ?').bind(adId).first<any>();
        expect(ad.quota_claimed).toBe(1);
    });

    /**
     * E-02: Idempotency test - same user claiming twice.
     *
     * Verifies: `getDetailedClaim` check prevents duplicate claim creation.
     * The second request should see the existing PENDING_CONFIRM claim and return
     * `already_claimed: true`.
     */
    it('E-02: Same user claiming twice should return already_claimed on second request', async () => {
        const adId = 'ad_idempotent';
        await env.DB.prepare(`
            INSERT INTO ad_campaigns (ad_id, a_x_id, unit_price_atomic, quota_total, quota_claimed, status, detail_url, end_date)
            VALUES (?, 'adv_1', '1000000', 10, 0, 'ACTIVE', 'https://x.com/target', '2099-01-01 00:00:00')
        `).bind(adId).run();

        const XID = '1236539014406012928'; // Whitelist ID
        await env.DB.prepare('INSERT INTO kol_binding (x_id, cdp_user_id) VALUES (?, ?)').bind(XID, 'cdp_idem').run();

        const makeReq = () => new Request('http://localhost/ads/executor/claim', {
            method: 'POST',
            body: JSON.stringify({
                ad_id: adId, b_x_id: XID, b_wallet: '0xwallet',
                proof_data: { following: true }, proof_type: 'twitter_profile_spotlight', category: 'follow'
            })
        });

        // First claim
        const res1 = await app.fetch(makeReq(), TEST_ENV as any);
        const data1 = await res1.json<any>();
        expect(data1.success).toBe(true);

        // Second claim by same user
        const res2 = await app.fetch(makeReq(), TEST_ENV as any);
        const data2 = await res2.json<any>();
        expect(data2.success).toBe(true);
        expect(data2.already_claimed).toBe(true);

        // Database should have exactly 1 claim record
        const count = await env.DB.prepare('SELECT COUNT(*) as cnt FROM ad_reward_claims WHERE ad_id = ? AND b_x_id = ?')
            .bind(adId, XID).first<any>();
        expect(count.cnt).toBe(1);

        // quota_claimed should be 1, not 2
        const ad = await env.DB.prepare('SELECT quota_claimed FROM ad_campaigns WHERE ad_id = ?').bind(adId).first<any>();
        expect(ad.quota_claimed).toBe(1);
    });
});
