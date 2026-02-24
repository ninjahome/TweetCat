import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as adsSrv from '../src/api_srv_ads';
import * as x402Srv from '../src/api_srv_x402';
import { app } from '../src/common';
import { registerSrv } from '../src/api_srv';

// Fix: Mock common BEFORE anything else uses it
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
        verifySignatureMiddleware: async (c: any, next: any) => await next(), // Disable middleware logic
    };
});

// Mock X402 routes
vi.mock('../src/api_srv_x402', () => {
    return {
        internalTreasurySettle: vi.fn(),
        PaymentRequiredError: class extends Error { statusCode = 402; },
        x402Workflow: vi.fn(),
        apiHandleTip: vi.fn(),
        apiX402UsdcTransfer: vi.fn(),
        apiTransferByTid: vi.fn(),
    };
});

// Mock User APIs
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

const TEST_XID = 'test_user_123';
const TEST_WALLET = '0x1234567890123456789012345678901234567890';
const TEST_TREASURY = '0x8888888888888888888888888888888888888888';

const TEST_ENV = {
    ...env,
    TREASURY_ADDRESS: TEST_TREASURY,
    CDP_API_KEY_ID: 'mock_id',
    CDP_API_KEY_SECRET: 'mock_secret',
    CDP_WALLET_SECRET: 'mock_wallet_secret',
};

describe('Ads Integration Tests', () => {

    beforeEach(async () => {
        if (!routesRegistered) {
            registerSrv(app);
            routesRegistered = true;
        }
        // Clean up and Setup Tables
        await env.DB.prepare('DROP TABLE IF EXISTS ad_performer_ledger').run();
        await env.DB.prepare('DROP TABLE IF EXISTS ad_performer_accounts').run();
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

        // Insert Test User
        await env.DB.prepare('INSERT INTO kol_binding (x_id, cdp_user_id, wallet_address) VALUES (?, ?, ?)')
            .bind(TEST_XID, 'cdp_123', TEST_WALLET).run();
    });

    it('B-05: Should handle duplicate recharge txHash gracefully (Idempotency)', async () => {
        // 1. Mock x402Workflow to return SAME txHash
        const TX_HASH = '0xrecharge_hash';
        (x402Srv.x402Workflow as any).mockResolvedValue({
            transaction: TX_HASH,
            payer: TEST_WALLET
        });

        // 2. Perform recharge twice
        const req1 = new Request('http://localhost/ads/publisher/recharge', {
            method: 'POST',
            body: JSON.stringify({ a_x_id: TEST_XID, amount: '5.0' }),
            headers: { 'Content-Type': 'application/json' }
        });
        await app.fetch(req1.clone(), TEST_ENV);

        const res2 = await app.fetch(req1.clone(), TEST_ENV);
        const data2 = await res2.json() as any;
        if (res2.status !== 200) console.log('B-05 Error:', data2);
        expect(res2.status).toBe(200);
        expect(data2.success).toBe(true);

        // 3. Verify balance is only added ONCE (5 USDC = 5000000)
        const account = await env.DB.prepare('SELECT available_atomic FROM ad_escrow_accounts WHERE a_x_id = ?')
            .bind(TEST_XID).first<any>();
        expect(account.available_atomic).toBe('5000000');
    });

    it('B-15: Should handle concurrent recharge with different txHash correctly', async () => {
        // 1. Mock x402Workflow to return DIFFERENT txHashes sequentially
        (x402Srv.x402Workflow as any).mockResolvedValueOnce({ transaction: '0x1', payer: TEST_WALLET })
            .mockResolvedValueOnce({ transaction: '0x2', payer: TEST_WALLET });

        // 2. Perform two recharges concurrently
        const req1 = new Request('http://localhost/ads/publisher/recharge', {
            method: 'POST',
            body: JSON.stringify({ a_x_id: TEST_XID, amount: '5.0' }),
            headers: { 'Content-Type': 'application/json' }
        });
        const req2 = new Request('http://localhost/ads/publisher/recharge', {
            method: 'POST',
            body: JSON.stringify({ a_x_id: TEST_XID, amount: '3.0' }),
            headers: { 'Content-Type': 'application/json' }
        });

        const [r1, r2] = await Promise.all([
            app.fetch(req1, TEST_ENV),
            app.fetch(req2, TEST_ENV)
        ]);

        if (r1.status !== 200) console.log('B-15 R1 Error:', await r1.json());
        if (r2.status !== 200) console.log('B-15 R2 Error:', await r2.json());
        expect(r1.status).toBe(200);
        expect(r2.status).toBe(200);

        // 3. Verify balance is 5+3 = 8000000
        const account = await env.DB.prepare('SELECT available_atomic FROM ad_escrow_accounts WHERE a_x_id = ?')
            .bind(TEST_XID).first<any>();
        expect(account.available_atomic).toBe('8000000');
    });

    it('B-11: Should intercept new withdrawal if there is a PENDING one', async () => {
        // 1. Setup a PENDING withdrawal for this week
        const now = new Date();
        const year = now.getUTCFullYear();
        const firstThursday = new Date(Date.UTC(now.getUTCFullYear(), 0, 4));
        const weekNum = Math.ceil((((now.getTime() - firstThursday.getTime()) / 86400000) + firstThursday.getUTCDay() + 1) / 7);
        const requestId = `executor_withdraw_${TEST_XID}_${year}_W${weekNum}`;

        await env.DB.prepare('INSERT INTO ad_performer_ledger (ledger_id, b_x_id, status, request_id, amount_atomic) VALUES (?, ?, ?, ?, ?)')
            .bind('existing_ledger_1', TEST_XID, 'PENDING', requestId, '1000000').run();

        // 2. Try to withdraw again
        const req = new Request('http://localhost/ads/executor/withdraw', {
            method: 'POST',
            body: JSON.stringify({ b_x_id: TEST_XID, amount: '1.0' }),
            headers: { 'Content-Type': 'application/json' }
        });

        const res = await app.fetch(req, TEST_ENV);
        const data = await res.json() as any;

        expect(data.alreadyWithdrawn).toBe(true);
        expect(data.status).toBe('PENDING');
    });

    it('B-10: Should refund balance if treasury payout fails', async () => {
        // 1. Setup balance
        await env.DB.prepare('INSERT INTO ad_performer_accounts (b_x_id, available_atomic) VALUES (?, ?)')
            .bind(TEST_XID, '5000000').run();

        // 2. Mock treasury failure
        (x402Srv.internalTreasurySettle as any).mockRejectedValue(new Error('Blockchain Congestion'));

        // 3. Initiate withdrawal
        const req = new Request('http://localhost/ads/executor/withdraw', {
            method: 'POST',
            body: JSON.stringify({ b_x_id: TEST_XID, amount: '1.0' }),
            headers: { 'Content-Type': 'application/json' }
        });

        const res = await app.fetch(req, TEST_ENV);
        expect(res.status).toBe(500);

        // 4. Verify balance is refunded
        const account = await env.DB.prepare('SELECT available_atomic FROM ad_performer_accounts WHERE b_x_id = ?')
            .bind(TEST_XID).first<any>();
        expect(account.available_atomic).toBe('5000000'); // Still 5 USDC

        // 5. Verify ledger status
        const ledger = await env.DB.prepare('SELECT status, error_reason FROM ad_performer_ledger WHERE b_x_id = ?')
            .bind(TEST_XID).first<any>();
        expect(ledger.status).toBe('FAILED');
        expect(ledger.error_reason).toBe('Blockchain Congestion');
    });

    it('B-09: Should succeed if previous withdrawal was in a different week (Simulator)', async () => {
        // 1. Setup balance
        await env.DB.prepare('INSERT INTO ad_performer_accounts (b_x_id, available_atomic) VALUES (?, ?)')
            .bind(TEST_XID, '5000000').run();

        // 2. Setup a SETTLED withdrawal for "W-1" (different week)
        await env.DB.prepare('INSERT INTO ad_performer_ledger (ledger_id, b_x_id, status, request_id, amount_atomic, created_at) VALUES (?, ?, ?, ?, ?, ?)')
            .bind('prev_ledger', TEST_XID, 'SETTLED', `executor_withdraw_${TEST_XID}_2025_W1`, '1000000', '2025-01-01 10:00:00').run();

        // 3. Mock success
        (x402Srv.internalTreasurySettle as any).mockResolvedValue({
            success: true,
            transaction: '0xmockhash',
            payer: '0xtreasury'
        });

        // 4. Initiate withdrawal
        const req = new Request('http://localhost/ads/executor/withdraw', {
            method: 'POST',
            body: JSON.stringify({ b_x_id: TEST_XID, amount: '1.0' }),
            headers: { 'Content-Type': 'application/json' }
        });

        const res = await app.fetch(req, TEST_ENV);
        const data = await res.json() as any;
        expect(data.success).toBe(true);
        expect(data.txHash).toBe('0xmockhash');

        // 5. Verify balance deducted
        const account = await env.DB.prepare('SELECT available_atomic FROM ad_performer_accounts WHERE b_x_id = ?')
            .bind(TEST_XID).first<any>();
        expect(account.available_atomic).toBe('4000000'); // 5 - 1 = 4
    });

    it('B-14: Should fail if user has no bound wallet', async () => {
        const UNBOUND_XID = 'unbound_user';
        await env.DB.prepare('INSERT INTO kol_binding (x_id, cdp_user_id, wallet_address) VALUES (?, ?, NULL)')
            .bind(UNBOUND_XID, 'cdp_unbound').run();

        const req = new Request('http://localhost/ads/executor/withdraw', {
            method: 'POST',
            body: JSON.stringify({ b_x_id: UNBOUND_XID, amount: '1.0' }),
            headers: { 'Content-Type': 'application/json' }
        });

        const res = await app.fetch(req, TEST_ENV);
        const data = await res.json() as any;
        expect(res.status).toBe(400);
        expect(data.error).toBe('WALLET_NOT_BOUND');
    });
});
