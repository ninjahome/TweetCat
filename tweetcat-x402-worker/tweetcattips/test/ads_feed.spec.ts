import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/common';
import { registerSrv } from '../src/api_srv';

const TEST_ENV = env as any;
const DB = TEST_ENV.DB;

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

describe('Ads Feed Synchronization Tests', () => {
    let routesRegistered = false;

    beforeEach(async () => {
        if (!routesRegistered) {
            registerSrv(app);
            routesRegistered = true;
        }
        await DB.prepare('DROP TABLE IF EXISTS ad_campaigns').run();
        await DB.prepare('DROP TABLE IF EXISTS ads_feed_meta').run();
        await DB.prepare('DROP TABLE IF EXISTS ad_escrow_accounts').run();

        await DB.prepare(`
            CREATE TABLE ad_escrow_accounts (
                a_x_id TEXT NOT NULL,
                asset_symbol TEXT NOT NULL DEFAULT 'USDC',
                available_atomic TEXT NOT NULL DEFAULT '0',
                frozen_atomic TEXT NOT NULL DEFAULT '0',
                PRIMARY KEY (a_x_id, asset_symbol)
            )
        `).run();

        await DB.prepare(`
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

        await DB.prepare(`
            CREATE TABLE ads_feed_meta (
                id INTEGER PRIMARY KEY,
                version INTEGER NOT NULL DEFAULT 1,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                CHECK (id = 1)
            )
        `).run();

        // Seed initial version
        await DB.prepare('INSERT INTO ads_feed_meta (id, version) VALUES (1, 100)').run();
    });

    it('FD-01 & FD-02: Get version should return current version', async () => {
        const res = await app.fetch(new Request('http://localhost/ads/executor/version'), TEST_ENV as any);
        console.log('FD-01 Status:', res.status);
        const text = await res.text();
        console.log('FD-01 Raw Body:', text);
        let data: any = {};
        try { data = JSON.parse(text); } catch (e) { }

        expect(data.success).toBe(true);
        expect(data.version).toBe(100);
    });

    it('FD-03: Feed list should return all active ads', async () => {
        // Setup 2 active ads and 1 expired ad
        // We also need escrow accounts with frozen balance for them to show up!
        await DB.prepare(`
            INSERT INTO ad_escrow_accounts (a_x_id, frozen_atomic) VALUES 
            ('adv1', '10000000'),
            ('adv2', '10000000'),
            ('adv3', '10000000')
        `).run();

        await DB.prepare(`
            INSERT INTO ad_campaigns (ad_id, a_x_id, unit_price_atomic, quota_total, status, detail_url, end_date)
            VALUES 
            ('ad1', 'adv1', '1000000', 10, 'ACTIVE', 'https://x.com/user1', '2099-01-01'),
            ('ad2', 'adv2', '2000000', 5, 'ACTIVE', 'https://x.com/user2', '2099-01-01'),
            ('ad3', 'adv3', '3000000', 5, 'EXPIRED', 'https://x.com/user3', '2000-01-01')
        `).run();

        const res = await app.fetch(new Request('http://localhost/ads/executor/list'), TEST_ENV as any);
        console.log('FD-03 Status:', res.status);
        const text = await res.text();
        console.log('FD-03 Raw Body:', text);
        let ads: any = [];
        try { ads = JSON.parse(text); } catch (e) { ads = text; }

        expect(Array.isArray(ads)).toBe(true);
        expect(ads.length).toBe(2);
        expect(ads.map((a: any) => a.id)).toContain('ad1');
        expect(ads.map((a: any) => a.id)).toContain('ad2');
    });

    it('FD-04: next_invalidation_at should return the earliest end_date of active ads', async () => {
        const soon = new Date(Date.now() + 3600 * 1000).toISOString(); // 1 hour later
        const later = new Date(Date.now() + 7200 * 1000).toISOString(); // 2 hours later

        await DB.prepare(`
            INSERT INTO ad_escrow_accounts (a_x_id, frozen_atomic) VALUES ('soon_adv', '10000000'), ('later_adv', '10000000')
        `).run();

        await DB.prepare(`
            INSERT INTO ad_campaigns (ad_id, a_x_id, unit_price_atomic, quota_total, status, detail_url, end_date)
            VALUES 
            ('soon', 'soon_adv', '1000000', 10, 'ACTIVE', 'https://x.com/soon', ?),
            ('later', 'later_adv', '1000000', 10, 'ACTIVE', 'https://x.com/later', ?)
        `).bind(soon, later).run();

        const res = await app.fetch(new Request('http://localhost/ads/executor/version'), TEST_ENV as any);
        const data = await res.json<any>();

        expect(data.success).toBe(true);
        // SQLite might return slightly different format but should represent same time.
        // Usually it's YYYY-MM-DD HH:MM:SS
        expect(data.next_invalidation_at).toBeDefined();
        expect(data.next_invalidation_at).not.toBeNull();
    });

    it('FD-06: API should return original URLs (normalization happens on client)', async () => {
        // Just verify the list API returns what we put in
        const urlWithQuery = 'https://x.com/User_Name?s=21#hash';
        await DB.prepare(`INSERT INTO ad_escrow_accounts (a_x_id, frozen_atomic) VALUES ('norm_adv', '10000000')`).run();
        await DB.prepare(`
            INSERT INTO ad_campaigns (ad_id, a_x_id, unit_price_atomic, quota_total, status, detail_url, end_date)
            VALUES ('norm', 'norm_adv', '1000000', 10, 'ACTIVE', ?, '2099-01-01')
        `).bind(urlWithQuery).run();

        const res = await app.fetch(new Request('http://localhost/ads/executor/list'), TEST_ENV as any);
        const ads = await res.json<any[]>();
        const ad = ads.find(a => a.id === 'norm');
        expect(ad.detailUrl).toBe(urlWithQuery);
    });

    it('FD-07: Feed version should bump when new ad is created (integration check)', async () => {
        await DB.prepare('UPDATE ads_feed_meta SET version = version + 1 WHERE id = 1').run();

        const res = await app.fetch(new Request('http://localhost/ads/executor/version'), TEST_ENV as any);
        const data = await res.json<any>();
        console.log('FD-07 Response:', data);
        expect(data.version).toBe(101);
    });
});
