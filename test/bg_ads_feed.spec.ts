import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pollAdsFeedIfNeeded } from '../src/service_work/bg_ads_feed';
import * as localStorage from '../src/common/local_storage';
import * as walletSetting from '../src/wallet/wallet_setting';
import * as database from '../src/common/database';

vi.mock('../src/common/local_storage', () => ({
    localGet: vi.fn(),
    localSet: vi.fn(),
}));

vi.mock('../src/wallet/wallet_setting', () => ({
    getChainId: vi.fn(),
}));

vi.mock('../src/common/x402_obj', () => ({
    X402_FACILITATORS: {
        1: { endpoint: 'http://localhost' },
    },
}));

vi.mock('../src/common/database', () => ({
    checkAndInitDatabase: vi.fn().mockResolvedValue(undefined),
    databaseUpdateOrAddItem: vi.fn().mockResolvedValue(undefined),
    databaseClear: vi.fn().mockResolvedValue(undefined),
    __tableAdsFeedMeta: 'meta',
    __tableAdsFollowOffers: 'offers',
}));

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Service Worker: pollAdsFeedIfNeeded', () => {

    beforeEach(() => {
        vi.clearAllMocks();
        (walletSetting.getChainId as any).mockResolvedValue(1);
        // Reset local storage mocks
        (localStorage.localGet as any).mockResolvedValue(null);
        (localStorage.localSet as any).mockResolvedValue(undefined);
    });

    it('FD-05: Should protect against concurrent polls (pollInFlight)', async () => {
        // Setup version fetch to be SLOW
        let resolveVersion: any;
        const versionPromise = new Promise(resolve => {
            resolveVersion = () => resolve({
                ok: true,
                json: async () => ({
                    success: true,
                    version: 1,
                    next_invalidation_at: null
                })
            });
        });

        mockFetch.mockImplementation(() => versionPromise);

        // Start first poll
        const p1 = pollAdsFeedIfNeeded();

        // Start second poll IMMEDIATELY
        const p2 = pollAdsFeedIfNeeded();

        // Complete the version fetch
        resolveVersion();

        await Promise.all([p1, p2]);

        // Only ONE fetch to /ads/executor/version should happen
        const versionCalls = mockFetch.mock.calls.filter(c => c[0].endsWith('/ads/executor/version'));
        expect(versionCalls.length).toBe(1);
    });
});
