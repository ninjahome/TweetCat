
-- ⚠️ WARNING: This script will drop all existing tables and recreate them. 
-- All data will be lost. This is intended for environment synchronization and clean rebuilds.

-- 1. Drop existing tables in reverse order of dependencies
DROP TABLE IF EXISTS ad_claim_evidence;
DROP TABLE IF EXISTS ad_reward_claims;
DROP TABLE IF EXISTS ad_campaigns;
DROP TABLE IF EXISTS ad_escrow_ledger;
DROP TABLE IF EXISTS ad_escrow_accounts;
DROP TABLE IF EXISTS ads_feed_meta;
DROP TABLE IF EXISTS onramp_purchases;
DROP TABLE IF EXISTS platform_fees;
DROP TABLE IF EXISTS x402_failures;
DROP TABLE IF EXISTS user_rewards;
DROP TABLE IF EXISTS replay_guard;
DROP TABLE IF EXISTS tip_escrow;
DROP TABLE IF EXISTS kol_binding;

-- 2. Create tables

-- 用户绑定信息表 (Core User Table)
CREATE TABLE kol_binding (
    x_id                   TEXT PRIMARY KEY,                  -- Twitter/X sub (User ID)
    cdp_user_id            TEXT UNIQUE,                       -- Coinbase CDP User ID
    wallet_address         TEXT,                              -- CDP EOA Wallet Address
    email                  TEXT DEFAULT '',
    username               TEXT DEFAULT '',                   -- Twitter/X Username
    signin_time            DATETIME,                          -- 最后一次登录/活跃时间
    evm_account_created_at DATETIME,                          -- Coinbase 侧钱包创建时间
    device_pubkey_spki     TEXT,                              -- 设备端生成的公钥 (用于 DPoP 或其他验证)
    device_key_updated_at  DATETIME,
    created_at             DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 打赏临时托管表 (用户登录并绑定钱包前，收到的打赏暂存在此)
CREATE TABLE tip_escrow (
    x_id          TEXT PRIMARY KEY,
    amount_atomic TEXT    NOT NULL,           -- 打赏总额 (USDC atomic string)
    status        INTEGER NOT NULL DEFAULT 0, -- 0: Pending, 10: Claimed (Already moved to user_rewards)
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    CHECK (status IN (0, 10))
);
CREATE INDEX idx_tip_escrow_status ON tip_escrow (status);

-- DPoP 重放攻击保护表 (手动 TTL 清理)
CREATE TABLE replay_guard (
    jkt        TEXT NOT NULL, -- JWT Key Thumbprint
    jti        TEXT NOT NULL, -- JWT ID
    iat        INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    PRIMARY KEY (jkt, jti)
);
CREATE INDEX idx_replay_guard_expires ON replay_guard(expires_at);

-- 用户奖励余额表 (用户完成广告或领取打赏后的正式余额)
CREATE TABLE user_rewards (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    cdp_user_id    TEXT    NOT NULL, -- 关联 kol_binding.cdp_user_id
    asset_symbol   TEXT    NOT NULL DEFAULT 'USDC',
    asset_address  TEXT,             -- 资产合约地址 (可选)
    amount_atomic  TEXT    NOT NULL, -- 余额 (USDC atomic string)
    
    -- 0: Pending (钱包内可见、待提现), 10: Locked (提现中), 
    -- 20: Success (已成功结算至链上), 30: Failed (提现失败), 40: Cancelled (取消)
    status         INTEGER NOT NULL DEFAULT 0,
    
    tx_hash        TEXT,             -- 提现交易哈希
    reason         TEXT,             -- 奖励/变动说明
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
    CHECK (status IN (0, 10, 20, 30, 40)),
    FOREIGN KEY (cdp_user_id) REFERENCES kol_binding(cdp_user_id) ON DELETE CASCADE
);
CREATE INDEX idx_user_rewards_user_id ON user_rewards (cdp_user_id);
CREATE INDEX idx_user_rewards_status ON user_rewards (status);
-- 唯一索引保障：一个用户在同种资产下只能有一个 PENDING 状态的余额行，用于 UPSERT 逻辑
CREATE UNIQUE INDEX ux_user_rewards_pending_balance ON user_rewards(cdp_user_id, asset_symbol) WHERE status = 0;

-- X402 验证/结算失败记录表
CREATE TABLE x402_failures (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    kind       TEXT NOT NULL, -- fail_type
    stage      TEXT NOT NULL, -- fail_stage
    context    TEXT,          -- ID 或其他关联信息
    message    TEXT,          -- 错误信息
    raw_json   TEXT,          -- 原始报错 JSON
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_x402_failures_created_at ON x402_failures(created_at);

-- 平台提现收费记录表
CREATE TABLE platform_fees (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    reward_id               INTEGER NOT NULL,          -- 关联 user_rewards.id
    cdp_user_id             TEXT NOT NULL,             -- 用户 ID
    gross_amount            TEXT NOT NULL,             -- 提现总额
    fee_rate                INTEGER NOT NULL,          -- 费率 (百分比，如 5 表示 5%)
    fee_amount              TEXT NOT NULL,             -- 手续费金额
    net_amount              TEXT NOT NULL,             -- 用户实得金额
    tx_hash                 TEXT,
    user_wallet_address     TEXT,
    platform_wallet_address TEXT,
    created_at              DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at              DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (reward_id) REFERENCES user_rewards(id) ON DELETE CASCADE,
    FOREIGN KEY (cdp_user_id) REFERENCES kol_binding(cdp_user_id)
);
CREATE UNIQUE INDEX idx_platform_fees_reward ON platform_fees(reward_id);
CREATE INDEX idx_platform_fees_user ON platform_fees(cdp_user_id, created_at DESC);

-- Onramp (法币入金) 历史记录表
CREATE TABLE onramp_purchases (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    cdp_user_id             TEXT NOT NULL,
    destination_address     TEXT NOT NULL,
    amount_fiat             TEXT NOT NULL,             -- 法币金额 (单位：分)
    amount_crypto           TEXT,                      -- 预计/实际换出的加密货币金额
    asset                   TEXT NOT NULL,             -- 例如 'USDC'
    blockchain              TEXT NOT NULL,             -- 例如 'base'
    coinbase_transaction_id TEXT,                      -- Coinbase 的交易 UUID
    onramp_session_id       TEXT,                      -- Coinbase Session ID
    status                  TEXT NOT NULL DEFAULT 'pending', -- pending, completed, failed
    tx_hash                 TEXT,                      -- 链上交易 Hash
    payment_method          TEXT,                      -- 支付方式
    error_message           TEXT,
    created_at              DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at              DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at            DATETIME,
    FOREIGN KEY (cdp_user_id) REFERENCES kol_binding(cdp_user_id)
);
CREATE INDEX idx_onramp_purchases_user ON onramp_purchases(cdp_user_id, created_at DESC);
CREATE UNIQUE INDEX ux_onramp_purchases_coinbase_tx ON onramp_purchases(coinbase_transaction_id) WHERE coinbase_transaction_id IS NOT NULL;

-- 广告广场 Feed 元信息表 (用于缓存版本控制)
CREATE TABLE ads_feed_meta (
    id         INTEGER PRIMARY KEY, -- 只存一条记录，id=1
    version    INTEGER NOT NULL DEFAULT 1,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    CHECK (id = 1)
);
INSERT OR IGNORE INTO ads_feed_meta(id, version) VALUES(1, 1);

-- 广告主托管账户 (发布广告所需的预算池)
CREATE TABLE ad_escrow_accounts (
    a_x_id           TEXT NOT NULL,
    asset_symbol     TEXT NOT NULL DEFAULT 'USDC',
    available_atomic TEXT NOT NULL DEFAULT '0', -- 可用于发布广告的余额
    frozen_atomic    TEXT NOT NULL DEFAULT '0', -- 已发布广告正在锁定的预算（结算中或广告活跃中）
    created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (a_x_id, asset_symbol),
    CHECK (CAST(available_atomic AS INTEGER) >= 0),
    CHECK (CAST(frozen_atomic AS INTEGER) >= 0),
    FOREIGN KEY (a_x_id) REFERENCES kol_binding(x_id)
);

-- 广告账户托管流水 (充值/提现)
CREATE TABLE ad_escrow_ledger (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    ledger_id        TEXT NOT NULL, -- 服务端生成的 UUID
    a_x_id           TEXT NOT NULL,
    direction        TEXT NOT NULL, -- 'DEPOSIT' (外部充值进 ad_escrow), 'WITHDRAW' (从 ad_escrow 提到个人余额)
    asset_symbol     TEXT NOT NULL DEFAULT 'USDC',
    amount_atomic    TEXT NOT NULL,
    payer_address    TEXT,          -- 付款钱包地址
    receiver_address TEXT,          -- 收款钱包地址
    tx_hash          TEXT,          -- 链上关联交易 Hash (Deposit 为充值 Hash, Withdraw 为转账 Hash)
    status           TEXT NOT NULL DEFAULT 'PENDING', -- PENDING, SETTLED, FAILED
    request_id       TEXT,          -- 幂等请求 ID
    memo             TEXT,
    error_reason     TEXT,
    created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
    CHECK (direction IN ('DEPOSIT', 'WITHDRAW')),
    CHECK (status IN ('PENDING', 'SETTLED', 'FAILED')),
    UNIQUE (tx_hash),
    UNIQUE (a_x_id, direction, request_id),
    FOREIGN KEY (a_x_id) REFERENCES kol_binding(x_id)
);
CREATE INDEX idx_ad_escrow_ledger_user ON ad_escrow_ledger(a_x_id, created_at DESC);

-- 广告活动 (Campaigns) 表
CREATE TABLE ad_campaigns (
    ad_id              TEXT PRIMARY KEY,
    a_x_id             TEXT NOT NULL, -- 广告主 X ID
    category           TEXT NOT NULL, -- follow, visit, register, share
    name               TEXT NOT NULL, -- 广告名称 (内部管理用)
    title              TEXT NOT NULL, -- 用户看到的标题
    description        TEXT NOT NULL, -- 用户看到的描述
    detail_url         TEXT NOT NULL, -- 活动链接
    image_url          TEXT,
    callback_url       TEXT,
    custom_data        TEXT,          -- JSON 格式的扩展数据
    unit_price_atomic  TEXT NOT NULL, -- 每次领取的单价
    quota_total        INTEGER NOT NULL, -- 总发放额度 (次数)
    quota_claimed      INTEGER DEFAULT 0, -- 已领取的占位额度 (防止超发)
    quota_used         INTEGER DEFAULT 0, -- 最终结算成功的额度
    status             TEXT DEFAULT 'ACTIVE', -- DRAFT, ACTIVE, PAUSED_NO_BUDGET, PAUSED_MANUAL, EXPIRED, COMPLETED
    
    -- 预算退回状态：NONE: 未结束, SETTLED: 广告结束且剩余冻结资产已退回到 ad_escrow_accounts.available
    budget_settlement_status TEXT NOT NULL DEFAULT 'NONE', 
    
    end_date           DATETIME NOT NULL,
    created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
    CHECK (status IN ('DRAFT', 'ACTIVE', 'PAUSED_NO_BUDGET', 'PAUSED_MANUAL', 'EXPIRED', 'COMPLETED')),
    CHECK (budget_settlement_status IN ('NONE', 'SETTLED')),
    FOREIGN KEY (a_x_id) REFERENCES kol_binding(x_id)
);
CREATE INDEX idx_ad_campaigns_a_x_id ON ad_campaigns(a_x_id);
CREATE INDEX idx_ad_campaigns_status ON ad_campaigns(status);
CREATE INDEX idx_ad_campaigns_end_date ON ad_campaigns(end_date);

-- 广告任务领取与审核记录 (Claims)
CREATE TABLE ad_reward_claims (
    claim_id           TEXT PRIMARY KEY, -- 领取行为 UUID
    ad_id              TEXT NOT NULL,
    b_x_id             TEXT NOT NULL,    -- 领取人 (Performer) X ID
    b_wallet           TEXT,             -- 领取人 EOA 钱包 (结算时快照)
    
    -- CLAIMED: 已领取, PENDING_CONFIRM: 等待审核/验证, CONFIRMED: 验证通过并已结算到 performer 余额, 
    -- REJECTED: 验证失败, SETTLED_TIMEOUT: 自动结算完成
    status             TEXT NOT NULL,
    
    unit_price_atomic  TEXT,             -- 领取时广告的单价快照
    signature          TEXT,             -- 领取时的加密签名 (存证)
    proof              TEXT,             -- 简易证明材料 (废弃，详见 ad_claim_evidence)
    proof_type         TEXT,             -- 简易证明类型 (废弃)
    
    verified_at        DATETIME,         -- 审核通过时间
    verification_notes TEXT,             -- 审核备注/失败原因
    created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE (ad_id, b_x_id), -- 一个用户对一个广告只能领取一次
    FOREIGN KEY (ad_id) REFERENCES ad_campaigns(ad_id) ON DELETE CASCADE,
    FOREIGN KEY (b_x_id) REFERENCES kol_binding(x_id),
    CHECK (status IN ('CLAIMED', 'PENDING_CONFIRM', 'CONFIRMED', 'REJECTED', 'SETTLED_TIMEOUT'))
);
CREATE INDEX idx_ad_reward_claims_performer ON ad_reward_claims(b_x_id, created_at DESC);
CREATE INDEX idx_ad_reward_claims_ad ON ad_reward_claims(ad_id, status);

-- 广告任务证明材料 (Evidence)
CREATE TABLE ad_claim_evidence (
    evidence_id        TEXT PRIMARY KEY,
    claim_id           TEXT NOT NULL,    -- 关联 ad_reward_claims.claim_id
    ad_id              TEXT NOT NULL,
    b_x_id             TEXT NOT NULL,
    category           TEXT,             -- 领取的任务类型 (redundancy for fast query)
    proof_type         TEXT,             -- 'follow_status' | 'tweet_interaction' | 'screenshot' | 'manual'
    proof_data         TEXT,             -- 包含证明信息的 JSON
    observed_data      TEXT,             -- 自动验证观察到的快照 JSON
    created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (claim_id) REFERENCES ad_reward_claims(claim_id) ON DELETE CASCADE
);
CREATE INDEX idx_ad_claim_evidence_claim ON ad_claim_evidence(claim_id);
