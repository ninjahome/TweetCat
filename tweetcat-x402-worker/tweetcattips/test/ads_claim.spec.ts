import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerSrv } from '../src/api_srv';
import { app, arrayBufferToBase64Url } from '../src/common';
import * as dbAd from '../src/database_ad';

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

vi.mock('../src/database_ad', async (importOriginal) => {
    const original = await importOriginal<any>();
    return {
        ...original,
        createDetailedClaim: vi.fn(original.createDetailedClaim),
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

// Whitelisted user ID from api_srv_ads.ts
const WHITE_XID = '1899045104146644992';

describe('Ads Claim Flow Tests', () => {
    beforeEach(async () => {
        if (!routesRegistered) {
            registerSrv(app);
            routesRegistered = true;
        }

        // Clean up tables
        await env.DB.prepare('DROP TABLE IF EXISTS ad_claim_evidence').run();
        await env.DB.prepare('DROP TABLE IF EXISTS ad_reward_claims').run();
        await env.DB.prepare('DROP TABLE IF EXISTS ad_campaigns').run();
        await env.DB.prepare('DROP TABLE IF EXISTS ad_escrow_accounts').run();
        await env.DB.prepare('DROP TABLE IF EXISTS ads_feed_meta').run();
        await env.DB.prepare('DROP TABLE IF EXISTS kol_binding').run();

        // Recreate tables (Minimal versions needed for test)
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
				observed_data TEXT,
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP
			)
		`).run();

        // Setup Initial Data
        await env.DB.prepare('INSERT INTO kol_binding (x_id, cdp_user_id) VALUES (?, ?)').bind('advertiser_1', 'cdp_adv_1').run();
        await env.DB.prepare('INSERT INTO kol_binding (x_id, cdp_user_id) VALUES (?, ?)').bind(WHITE_XID, 'cdp_performer_1').run();

        await env.DB.prepare("INSERT INTO ad_escrow_accounts (a_x_id, frozen_atomic) VALUES (?, ?)")
            .bind('advertiser_1', '10000000') // 10 USDC frozen for the ad
            .run();

        await env.DB.prepare(`
			INSERT INTO ad_campaigns (ad_id, a_x_id, category, name, title, description, detail_url, unit_price_atomic, quota_total, end_date)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`).bind('ad_1', 'advertiser_1', 'follow', 'Campaign 1', 'Title', 'Desc', 'https://x.com/target', '1000000', 10, new Date(Date.now() + 86400000).toISOString()).run();
    });

    it('EX-05: Normal Follow Flow - Should claim ad and create evidence', async () => {
        const mockProofData = {
            data: {
                user_result_by_screen_name: {
                    result: {
                        relationship_perspectives: {
                            following: true
                        }
                    }
                }
            }
        };

        const reqBody = {
            ad_id: 'ad_1',
            b_x_id: WHITE_XID,
            b_wallet: '0xperformer_wallet',
            proof_data: mockProofData,
            proof_type: 'twitter_profile_spotlight',
            category: 'follow'
        };

        const res = await app.fetch(
            new Request('http://localhost/ads/executor/claim', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(reqBody),
            }),
            TEST_ENV as any
        );

        const resText = await res.text();
        const data = JSON.parse(resText);
        expect(res.status).toBe(200);
        expect(data.success).toBe(true);
        expect(typeof data.claim_id).toBe('string');
        expect(data.status).toBe('PENDING_CONFIRM');

        // 1. Check if quota_claimed was incremented
        const ad = await env.DB.prepare('SELECT quota_claimed FROM ad_campaigns WHERE ad_id = ?').bind('ad_1').first<{ quota_claimed: number }>();
        expect(ad?.quota_claimed).toBe(1);

        // 2. Check if ad_reward_claims record exists
        const claim = await env.DB.prepare('SELECT * FROM ad_reward_claims WHERE claim_id = ?').bind(data.claim_id).first<any>();
        expect(claim.status).toBe('PENDING_CONFIRM');
        expect(claim.b_x_id).toBe(WHITE_XID);
        expect(claim.ad_id).toBe('ad_1');

        // 3. Check if evidence was saved
        const evidence = await env.DB.prepare('SELECT * FROM ad_claim_evidence WHERE claim_id = ?').bind(data.claim_id).first<any>();
        expect(evidence.proof_type).toBe('twitter_profile_spotlight');
        const savedProof = JSON.parse(evidence.proof_data);
        expect(savedProof.data.user_result_by_screen_name.result.relationship_perspectives.following).toBe(true);
    });

    async function generateBlueVProof(xId: string, isBlueVerified: boolean = true) {
        const { publicKey, privateKey } = (await crypto.subtle.generateKey(
            { name: "ECDSA", namedCurve: "P-256" },
            true,
            ["sign", "verify"]
        )) as CryptoKeyPair;
        const pubKeySpki = (await crypto.subtle.exportKey("spki", publicKey)) as ArrayBuffer;
        const pubKeyB64 = arrayBufferToBase64Url(pubKeySpki);

        const proofObj = {
            userId: xId,
            screenName: 'user_' + xId,
            isBlueVerified: isBlueVerified,
            capturedAt: Date.now()
        };
        const dataToSign = new TextEncoder().encode(JSON.stringify(proofObj));
        const signature = (await crypto.subtle.sign(
            { name: "ECDSA", hash: { name: "SHA-256" } },
            privateKey,
            dataToSign
        )) as ArrayBuffer;
        const sigB64 = arrayBufferToBase64Url(signature);

        return {
            proof: {
                ...proofObj,
                signature: sigB64,
                devicePubKey: pubKeyB64
            },
            pubKeyB64
        };
    }

    it('EX-13: Blue V Evidence Signature Invalid - Should return INVALID_BLUE_V_PROOF', async () => {
        const bXId = 'user_123';
        const { proof, pubKeyB64 } = await generateBlueVProof(bXId);

        // Setup user with registered key
        await env.DB.prepare('INSERT INTO kol_binding (x_id, cdp_user_id, device_pubkey_spki) VALUES (?, ?, ?)')
            .bind(bXId, 'cdp_user_123', pubKeyB64)
            .run();

        const reqBody = {
            ad_id: 'ad_1',
            b_x_id: bXId,
            b_wallet: '0xperformer_wallet',
            proof_data: { some: 'activity' },
            proof_type: 'some_type',
            category: 'follow',
            blue_v_proof: {
                ...proof,
                signature: 'invalid_sig' // Tamper with signature
            }
        };

        const res = await app.fetch(
            new Request('http://localhost/ads/executor/claim', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(reqBody),
            }),
            TEST_ENV as any
        );

        const data = (await res.json()) as any;
        expect(res.status).toBe(401);
        expect(data.error).toBe('INVALID_BLUE_V_PROOF');
    });

    it('EX-14: Blue V userId Mismatch - Should return USER_MISMATCH', async () => {
        const bXId = 'user_real';
        // Proof specifies a different userId than the one in the request
        const { proof, pubKeyB64 } = await generateBlueVProof('user_fake');

        await env.DB.prepare('INSERT INTO kol_binding (x_id, cdp_user_id, device_pubkey_spki) VALUES (?, ?, ?)')
            .bind(bXId, 'cdp_user_real', pubKeyB64)
            .run();

        const reqBody = {
            ad_id: 'ad_1',
            b_x_id: bXId, // Request user ID
            b_wallet: '0xperformer_wallet',
            proof_data: { some: 'activity' },
            proof_type: 'some_type',
            category: 'follow',
            blue_v_proof: proof
        };

        const res = await app.fetch(
            new Request('http://localhost/ads/executor/claim', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(reqBody),
            }),
            TEST_ENV as any
        );

        const data = (await res.json()) as any;
        expect(res.status).toBe(401);
        expect(data.error).toBe('USER_MISMATCH');
    });

    it('EX-15: Blue V status false - Should return NOT_BLUE_VERIFIED', async () => {
        const bXId = 'user_not_v';
        const { proof, pubKeyB64 } = await generateBlueVProof(bXId, false); // isBlueVerified: false

        await env.DB.prepare('INSERT INTO kol_binding (x_id, cdp_user_id, device_pubkey_spki) VALUES (?, ?, ?)')
            .bind(bXId, 'cdp_user_not_v', pubKeyB64)
            .run();

        const reqBody = {
            ad_id: 'ad_1',
            b_x_id: bXId,
            b_wallet: '0xperformer_wallet',
            proof_data: { some: 'activity' },
            proof_type: 'some_type',
            category: 'follow',
            blue_v_proof: proof
        };

        const res = await app.fetch(
            new Request('http://localhost/ads/executor/claim', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(reqBody),
            }),
            TEST_ENV as any
        );

        const data = (await res.json()) as any;
        expect(res.status).toBe(401);
        expect(data.error).toBe('NOT_BLUE_VERIFIED');
    });

    it('EX-17: Claim Creation Failure Rollback - Should rollback quota_claimed', async () => {
        const adId = 'ad_rollback';
        const bXId = WHITE_XID; // Whitelist to skip Blue V check for simplicity

        // 1. Setup Ad with quota 10, claimed 0
        await env.DB.prepare(`
            INSERT INTO ad_campaigns (ad_id, a_x_id, category, name, title, description, detail_url, unit_price_atomic, quota_total, quota_claimed, end_date)
            VALUES (?, ?, 'follow', 'Rollback Ad', 'Title', 'Desc', 'http://url', '1000000', 10, 0, '2099-01-01 00:00:00')
        `).bind(adId, 'advertiser_1').run();

        // 2. Mock createDetailedClaim to fail
        vi.mocked(dbAd.createDetailedClaim).mockResolvedValueOnce(false);

        const reqBody = {
            ad_id: adId,
            b_x_id: bXId,
            b_wallet: '0xperformer_wallet',
            proof_data: { some: 'activity' },
            proof_type: 'some_type',
            category: 'follow'
        };

        const res = await app.fetch(
            new Request('http://localhost/ads/executor/claim', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(reqBody),
            }),
            TEST_ENV as any
        );

        // Expect 500 error
        expect(res.status).toBe(500);
        const data = await res.json() as any;
        expect(data.error).toBe('DB_ERROR');

        // 3. Verify quota_claimed was rolled back to 0
        const ad = await env.DB.prepare('SELECT quota_claimed FROM ad_campaigns WHERE ad_id = ?').bind(adId).first<any>();
        expect(ad.quota_claimed).toBe(0);

        // 4. Verify no claim was created (though mock failed, let's be sure)
        const claim = await env.DB.prepare('SELECT * FROM ad_reward_claims WHERE ad_id = ? AND b_x_id = ?').bind(adId, bXId).first<any>();
        expect(claim).toBeNull();
    });

    describe('Security & Signature Verification (S-01 to S-10)', () => {
        const XID = '666666';
        const ADDR = '0xperformer_666';

        beforeEach(async () => {
            await env.DB.prepare('INSERT INTO ad_campaigns (ad_id, a_x_id, category, name, title, description, detail_url, unit_price_atomic, quota_total, status, end_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
                .bind('ad_sec', 'adv_1', 'follow', 'Security Ad', 'Title', 'Desc', 'https://x.com/target', '1000000', 10, 'ACTIVE', '2099-01-01 00:00:00').run();
            // Note: kol_binding might already exist if we don't clean up, but beforeEach handles cleanup of tables.
            await env.DB.prepare('INSERT INTO kol_binding (x_id, cdp_user_id) VALUES (?, ?)').bind(XID, 'cdp_666').run();
        });

        it('S-01: Normal valid signature should PASS', async () => {
            const { proof } = await (generateBlueVProof as any)(XID, true);
            const reqBody = {
                ad_id: 'ad_sec', b_x_id: XID, b_wallet: ADDR,
                blue_v_proof: JSON.stringify(proof),
                proof_data: { following: true }, proof_type: 'twitter_profile_spotlight', category: 'follow'
            };
            const res = await app.fetch(new Request('http://localhost/ads/executor/claim', {
                method: 'POST', body: JSON.stringify(reqBody)
            }), TEST_ENV as any);
            const data = await res.json<any>();
            expect(data.success).toBe(true);
        });

        it('S-02: Tamper isBlueVerified (true -> false) should FAIL', async () => {
            const { proof } = await (generateBlueVProof as any)(XID, true);
            const proofObj = { ...proof };
            proofObj.isBlueVerified = false; // Tamper!
            const reqBody = {
                ad_id: 'ad_sec', b_x_id: XID, b_wallet: ADDR,
                blue_v_proof: JSON.stringify(proofObj),
                proof_data: { following: true }, proof_type: 'twitter_profile_spotlight', category: 'follow'
            };
            const res = await app.fetch(new Request('http://localhost/ads/executor/claim', {
                method: 'POST', body: JSON.stringify(reqBody)
            }), TEST_ENV as any);
            const data = await res.json<any>();
            expect(data.error).toBe('INVALID_BLUE_V_PROOF');
        });

        it('S-03: Tamper userId (Signature stays same) should FAIL with INVALID_BLUE_V_PROOF', async () => {
            const { proof } = await (generateBlueVProof as any)(XID, true);
            const proofObj = { ...proof };
            proofObj.userId = '999999'; // Tamper!
            const reqBody = {
                ad_id: 'ad_sec', b_x_id: XID, b_wallet: ADDR,
                blue_v_proof: JSON.stringify(proofObj),
                proof_data: { following: true }, proof_type: 'twitter_profile_spotlight', category: 'follow'
            };
            const res = await app.fetch(new Request('http://localhost/ads/executor/claim', {
                method: 'POST', body: JSON.stringify(reqBody)
            }), TEST_ENV as any);
            const data = await res.json<any>();
            expect(data.error).toBe('INVALID_BLUE_V_PROOF');
        });

        it('S-03b: Valid proof for OTHER user should FAIL with USER_MISMATCH', async () => {
            const { proof: otherProof } = await (generateBlueVProof as any)('other_user', true);
            const reqBody = {
                ad_id: 'ad_sec', b_x_id: XID, b_wallet: ADDR,
                blue_v_proof: JSON.stringify(otherProof),
                proof_data: { following: true }, proof_type: 'twitter_profile_spotlight', category: 'follow'
            };
            const res = await app.fetch(new Request('http://localhost/ads/executor/claim', {
                method: 'POST', body: JSON.stringify(reqBody)
            }), TEST_ENV as any);
            const data = await res.json<any>();
            expect(data.error).toBe('USER_MISMATCH');
        });

        it('S-04: Mismatched key (signed by attacker, verified by registered key) should FAIL', async () => {
            // Register a legit key
            const { publicKey: legitPubKey } = (await crypto.subtle.generateKey(
                { name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]
            )) as CryptoKeyPair;
            const legitPubKeyB64 = arrayBufferToBase64Url(await crypto.subtle.exportKey("spki", legitPubKey) as ArrayBuffer);
            await env.DB.prepare('UPDATE kol_binding SET device_pubkey_spki = ? WHERE x_id = ?').bind(legitPubKeyB64, XID).run();

            // Attacker signs with THEIR own key
            const { proof: attackerProof } = await (generateBlueVProof as any)(XID, true);
            // Even if attackerProof contains their own public key, the server uses the registered legitPubKeyB64

            const reqBody = {
                ad_id: 'ad_sec', b_x_id: XID, b_wallet: ADDR,
                blue_v_proof: JSON.stringify(attackerProof),
                proof_data: { following: true }, proof_type: 'twitter_profile_spotlight', category: 'follow'
            };
            const res = await app.fetch(new Request('http://localhost/ads/executor/claim', {
                method: 'POST', body: JSON.stringify(reqBody)
            }), TEST_ENV as any);
            const data = await res.json<any>();
            expect(data.error).toBe('INVALID_BLUE_V_PROOF');
        });

        it('S-05: Missing signature field should FAIL', async () => {
            const { proof } = await (generateBlueVProof as any)(XID, true);
            const proofObj = { ...proof };
            delete (proofObj as any).signature;
            const reqBody = {
                ad_id: 'ad_sec', b_x_id: XID, b_wallet: ADDR,
                blue_v_proof: JSON.stringify(proofObj),
                proof_data: { following: true }, proof_type: 'twitter_profile_spotlight', category: 'follow'
            };
            const res = await app.fetch(new Request('http://localhost/ads/executor/claim', {
                method: 'POST', body: JSON.stringify(reqBody)
            }), TEST_ENV as any);
            const data = await res.json<any>();
            expect(data.error).toBe('INVALID_BLUE_V_PROOF');
        });

        it('S-06: Missing devicePubKey field should FAIL', async () => {
            const { proof } = await (generateBlueVProof as any)(XID, true);
            const proofObj = { ...proof };
            delete (proofObj as any).devicePubKey;
            const reqBody = {
                ad_id: 'ad_sec', b_x_id: XID, b_wallet: ADDR,
                blue_v_proof: JSON.stringify(proofObj),
                proof_data: { following: true }, proof_type: 'twitter_profile_spotlight', category: 'follow'
            };
            const res = await app.fetch(new Request('http://localhost/ads/executor/claim', {
                method: 'POST', body: JSON.stringify(reqBody)
            }), TEST_ENV as any);
            const data = await res.json<any>();
            expect(data.error).toBe('INVALID_BLUE_V_PROOF');
        });

        it('S-07: Mixed Base64 and Base64URL should PASS (if correctly handled)', async () => {
            const { proof } = await (generateBlueVProof as any)(XID, true);
            const proofObj = { ...proof };
            // Convert signature to standard Base64 (with + and /)
            proofObj.signature = proofObj.signature.replace(/-/g, '+').replace(/_/g, '/');

            const reqBody = {
                ad_id: 'ad_sec', b_x_id: XID, b_wallet: ADDR,
                blue_v_proof: JSON.stringify(proofObj),
                proof_data: { following: true }, proof_type: 'twitter_profile_spotlight', category: 'follow'
            };
            const res = await app.fetch(new Request('http://localhost/ads/executor/claim', {
                method: 'POST', body: JSON.stringify(reqBody)
            }), TEST_ENV as any);
            const data = await res.json<any>();
            expect(data.success).toBe(true);
        });

        it('S-10: Self-signed with arbitrary key should FAIL if user has registered key', async () => {
            const { publicKey: legitPubKey } = (await crypto.subtle.generateKey(
                { name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]
            )) as CryptoKeyPair;
            const legitPubKeyB64 = arrayBufferToBase64Url(await crypto.subtle.exportKey("spki", legitPubKey));
            await env.DB.prepare('UPDATE kol_binding SET device_pubkey_spki = ? WHERE x_id = ?').bind(legitPubKeyB64, XID).run();

            const { proof: attackerProof } = await (generateBlueVProof as any)(XID, true);
            const reqBody = {
                ad_id: 'ad_sec', b_x_id: XID, b_wallet: ADDR,
                blue_v_proof: JSON.stringify(attackerProof),
                proof_data: { following: true }, proof_type: 'twitter_profile_spotlight', category: 'follow'
            };
            const res = await app.fetch(new Request('http://localhost/ads/executor/claim', {
                method: 'POST', body: JSON.stringify(reqBody)
            }), TEST_ENV as any);
            const data = await res.json<any>();
            expect(data.error).toBe('INVALID_BLUE_V_PROOF');
        });
    });
});
