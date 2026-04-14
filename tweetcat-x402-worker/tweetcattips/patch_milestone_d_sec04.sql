-- SEC-04: Add end-to-end claim signature persistence fields
-- Apply this patch only if ad_reward_claims.signature / ad_reward_claims.proof are missing.

-- Pre-check (run manually before ALTER if needed):
-- PRAGMA table_info('ad_reward_claims');

ALTER TABLE ad_reward_claims ADD COLUMN signature TEXT;
ALTER TABLE ad_reward_claims ADD COLUMN proof TEXT;

-- Post-check:
-- PRAGMA table_info('ad_reward_claims');
