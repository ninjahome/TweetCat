-- Add ad_claim_evidence table if it doesn't exist
CREATE TABLE IF NOT EXISTS ad_claim_evidence (
    evidence_id TEXT PRIMARY KEY,
    claim_id TEXT NOT NULL,
    ad_id TEXT NOT NULL,
    b_x_id TEXT NOT NULL,
    a_x_id TEXT NOT NULL,
    category TEXT NOT NULL,
    proof_type TEXT NOT NULL,
    proof_data TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(claim_id)
);

CREATE INDEX IF NOT EXISTS idx_evidence_claim_id ON ad_claim_evidence(claim_id);
CREATE INDEX IF NOT EXISTS idx_evidence_ad_id ON ad_claim_evidence(ad_id);

-- Add budget_settlement_status to ad_campaigns
ALTER TABLE ad_campaigns ADD COLUMN budget_settlement_status TEXT DEFAULT 'NONE';
