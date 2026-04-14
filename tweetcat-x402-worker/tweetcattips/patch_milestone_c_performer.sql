-- Create ad_performer_accounts table if it doesn't exist
CREATE TABLE IF NOT EXISTS ad_performer_accounts (
    b_x_id           TEXT NOT NULL,
    asset_symbol     TEXT NOT NULL DEFAULT 'USDC',
    available_atomic TEXT NOT NULL DEFAULT '0',
    withdrawn_atomic TEXT NOT NULL DEFAULT '0',
    created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (b_x_id, asset_symbol),
    FOREIGN KEY (b_x_id) REFERENCES kol_binding(x_id)
);

-- Create ad_performer_ledger table if it doesn't exist
CREATE TABLE IF NOT EXISTS ad_performer_ledger (
    ledger_id        TEXT PRIMARY KEY,
    b_x_id           TEXT NOT NULL,
    asset_symbol     TEXT NOT NULL DEFAULT 'USDC',
    amount_atomic    TEXT NOT NULL,
    receiver_address TEXT,
    status           TEXT NOT NULL DEFAULT 'PENDING', -- PENDING, SETTLED, FAILED
    request_id       TEXT,                             -- Idempotency key (e.g. executor_withdraw_xid_year_Wweek)
    tx_hash          TEXT,
    payer_address    TEXT,
    error_reason     TEXT,
    created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(request_id),
    FOREIGN KEY (b_x_id) REFERENCES kol_binding(x_id)
);

CREATE INDEX IF NOT EXISTS idx_performer_ledger_user ON ad_performer_ledger(b_x_id, created_at DESC);
