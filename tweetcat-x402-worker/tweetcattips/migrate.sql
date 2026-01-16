

-- 先删除旧表（如果已存在）
DROP TABLE IF EXISTS tip_escrow;

-- 用户奖励表
CREATE TABLE tip_escrow
(
	x_id          TEXT PRIMARY KEY,
	amount_atomic TEXT    NOT NULL,           -- 奖励总额（atomic 整数字符串）
	status        INTEGER NOT NULL DEFAULT 0, -- 状态：0: 待领取 (Pending), 10: 已完成 (Success)
	created_at    DATETIME         DEFAULT CURRENT_TIMESTAMP,
	updated_at    DATETIME         DEFAULT CURRENT_TIMESTAMP
		CHECK (status IN (0, 10))
);

CREATE INDEX idx_tip_escrow_xid ON tip_escrow (x_id);
CREATE INDEX idx_tip_escrow_status ON tip_escrow (status);
CREATE INDEX IF NOT EXISTS idx_tip_escrow_xid_status ON tip_escrow(x_id, status);





DROP TABLE IF EXISTS kol_binding;
CREATE TABLE kol_binding (
							 x_id TEXT PRIMARY KEY,
							 cdp_user_id TEXT UNIQUE,
							 wallet_address TEXT,
							 created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	, email TEXT DEFAULT '', username TEXT DEFAULT '', signin_time DATETIME, evm_account_created_at DATETIME)

-- 先删除旧表（如果已存在）
DROP TABLE IF EXISTS user_rewards;

-- 重新创建用户奖励明细表
CREATE TABLE user_rewards
(
	id             INTEGER PRIMARY KEY AUTOINCREMENT,
	cdp_user_id    TEXT    NOT NULL, -- 关联 kol_binding 的用户 ID

	-- 修改点 1：设置默认值为 'USDC'
	asset_symbol   TEXT    NOT NULL DEFAULT 'USDC',

	-- 修改点 2：允许为空 (移除 NOT NULL)
	asset_address  TEXT,

	amount_atomic  TEXT    NOT NULL, -- 奖励总额（atomic 整数字符串）

	-- 状态：0: 待领取 (Pending), 10: 锁定中 (Locked),20: 已完成 (Success), 30: 失败 (Failed) 40 CANCELLED/EXPIRED（取消/过期，终态）
	status         INTEGER NOT NULL DEFAULT 0,

	tx_hash        TEXT,             -- 转账后的链上交易哈希
	reason         TEXT,             -- 奖励描述

	created_at     DATETIME         DEFAULT CURRENT_TIMESTAMP,
	updated_at     DATETIME         DEFAULT CURRENT_TIMESTAMP,
	CHECK (status IN (0, 10, 20, 30, 40))
);

-- 重新创建索引
CREATE INDEX idx_user_rewards_user_id ON user_rewards (cdp_user_id);
CREATE INDEX idx_user_rewards_status ON user_rewards (status);
CREATE INDEX IF NOT EXISTS idx_user_rewards_user_status ON user_rewards(cdp_user_id, status);
CREATE INDEX IF NOT EXISTS idx_user_rewards_user_asset ON user_rewards(cdp_user_id, asset_address, status);
CREATE UNIQUE INDEX IF NOT EXISTS ux_user_rewards_pending
	ON user_rewards(cdp_user_id, asset_symbol)
	WHERE status = 0;

DROP TABLE IF EXISTS x402_failures;

CREATE TABLE IF NOT EXISTS x402_failures (
											 id         INTEGER PRIMARY KEY AUTOINCREMENT,
											 created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

											 kind       TEXT NOT NULL,  -- settle_failed / verify_failed / http_error / exception ...
											 stage      TEXT NOT NULL,  -- tip / claim / create_payload / verify / settle / ...
											 context    TEXT,           -- 例如: "reward:123" / "tip:tweetId=xxx" / "xId:elonmusk"

											 message    TEXT,           -- 人类可读的错误摘要
											 raw_json   TEXT            -- 原始对象（截断后的 JSON 字符串）
);

CREATE INDEX IF NOT EXISTS idx_x402_failures_created_at ON x402_failures(created_at);
CREATE INDEX IF NOT EXISTS idx_x402_failures_kind ON x402_failures(kind);

-- ============================================
-- 平台提现收费记录表
-- 用途：记录每笔用户提现时平台收取的手续费详情
-- ============================================
CREATE TABLE IF NOT EXISTS platform_fees (
											 id INTEGER PRIMARY KEY AUTOINCREMENT,
											 reward_id INTEGER NOT NULL,                    -- 关联的 user_rewards 记录 ID
											 cdp_user_id TEXT NOT NULL,                     -- CDP 用户 ID
											 gross_amount TEXT NOT NULL,                    -- 提现原始总额（用户的待提现金额）
											 fee_rate INTEGER NOT NULL,                     -- 收费比例（0-100 的整数，如 5 表示 5%）
											 fee_amount TEXT NOT NULL,                      -- 平台收取的手续费金额
											 net_amount TEXT NOT NULL,                      -- 用户实际到账金额（gross - fee）
											 tx_hash TEXT,                                  -- 链上转账交易哈希
											 user_wallet_address TEXT,                      -- 用户钱包地址（收款方）
											 platform_wallet_address TEXT,                  -- 平台钱包地址（发款方）
											 created_at TEXT NOT NULL DEFAULT (datetime('now')),  -- 记录创建时间
	updated_at TEXT NOT NULL DEFAULT (datetime('now')),  -- 记录更新时间
-- ==================== 外键约束 ====================
	FOREIGN KEY (reward_id) REFERENCES user_rewards(id) ON DELETE CASCADE
	);

-- ==================== 索引优化 ====================
-- 按用户查询收费记录
CREATE INDEX IF NOT EXISTS idx_platform_fees_user
	ON platform_fees(cdp_user_id, created_at DESC);

-- 按 reward_id 查询（确保唯一性：一个 reward 只能有一条收费记录）
CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_fees_reward
	ON platform_fees(reward_id);

-- 按交易哈希查询
CREATE INDEX IF NOT EXISTS idx_platform_fees_tx
	ON platform_fees(tx_hash) WHERE tx_hash IS NOT NULL;


-- Create Onramp Purchase History Table
CREATE TABLE IF NOT EXISTS onramp_purchases (
												id INTEGER PRIMARY KEY AUTOINCREMENT,
												cdp_user_id TEXT NOT NULL,                      -- CDP 用户 ID
												destination_address TEXT NOT NULL,              -- 接收地址
												amount_fiat TEXT NOT NULL,                      -- 法币金额（分，例如 "5000" 表示 $50.00）
												amount_crypto TEXT,                             -- 实际收到的加密货币金额（atomic units）
												asset TEXT NOT NULL,                            -- 资产类型（如 "USDC"）
												blockchain TEXT NOT NULL,                       -- 区块链（如 "base"）
												coinbase_transaction_id TEXT,                   -- Coinbase 交易 ID（用于 Webhook 更新）
												onramp_session_id TEXT,                         -- Onramp Session ID
												status TEXT NOT NULL DEFAULT 'pending',         -- 状态: pending, completed, failed
												tx_hash TEXT,                                   -- 区块链交易哈希
												payment_method TEXT,                            -- 支付方式: CARD_DEBIT, APPLE_PAY, etc.
												error_message TEXT,                             -- 错误信息（如果失败）
												created_at TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at TEXT NOT NULL DEFAULT (datetime('now')),
	completed_at TEXT                               -- 完成时间
	);

-- 索引优化
-- 按用户查询购买记录
CREATE INDEX IF NOT EXISTS idx_onramp_purchases_user
	ON onramp_purchases(cdp_user_id, created_at DESC);

-- 按 Coinbase 交易 ID 查询（用于 Webhook 更新）
CREATE UNIQUE INDEX IF NOT EXISTS idx_onramp_purchases_coinbase_tx
	ON onramp_purchases(coinbase_transaction_id)
	WHERE coinbase_transaction_id IS NOT NULL;

-- 按状态查询
CREATE INDEX IF NOT EXISTS idx_onramp_purchases_status
	ON onramp_purchases(status, created_at DESC);




-- 先删除旧表（如果已存在）
DROP TABLE IF EXISTS ads;

-- ads
CREATE TABLE IF NOT EXISTS ads (
								   ad_id TEXT PRIMARY KEY,
								   a_x_id TEXT NOT NULL,
								   ad_type TEXT NOT NULL,              -- e.g. FOLLOW_BLUE_V
								   category TEXT NOT NULL,             -- follow/visit/register/share
								   name TEXT NOT NULL,                 -- Ad Name (for your reference)
								   title TEXT NOT NULL,
								   description TEXT NOT NULL,
								   detail_url TEXT NOT NULL,
								   unit_price_atomic TEXT NOT NULL,    -- USDC atomic
								   quota_total INTEGER NOT NULL,
								   quota_used INTEGER NOT NULL DEFAULT 0,
								   status TEXT NOT NULL DEFAULT 'ACTIVE',
								   start_at TEXT,
								   end_at TEXT,
								   created_at TEXT NOT NULL DEFAULT (datetime('now'))
	);

CREATE INDEX IF NOT EXISTS idx_ads_status_created ON ads(status, created_at);
CREATE INDEX IF NOT EXISTS idx_ads_axid_created ON ads(a_x_id, created_at);

-- ad_account：先做账本余额（后续再接充值/链上）
CREATE TABLE IF NOT EXISTS ad_account (
										  a_x_id TEXT PRIMARY KEY,
										  asset_symbol TEXT NOT NULL DEFAULT 'USDC',
										  balance_atomic TEXT NOT NULL DEFAULT '0',
										  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
	);


DROP TABLE IF EXISTS ad_account;
CREATE TABLE IF NOT EXISTS ad_account (
										  a_x_id TEXT PRIMARY KEY,
										  asset_symbol TEXT NOT NULL DEFAULT 'USDC',
										  balance_atomic TEXT NOT NULL DEFAULT '0',
										  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
	);




CREATE TABLE IF NOT EXISTS claims (
									  claim_id TEXT PRIMARY KEY,
									  ad_id TEXT NOT NULL,
									  a_x_id TEXT NOT NULL,
									  b_x_id TEXT NOT NULL,
									  b_wallet TEXT NOT NULL,
									  status TEXT NOT NULL, -- CLAIMED / PENDING_CONFIRM / CONFIRMED / REJECTED / SETTLED_TIMEOUT
									  unit_price_atomic TEXT NOT NULL,
									  fee_rate REAL NOT NULL DEFAULT 0.05,
									  follow_receipt_sig TEXT,
									  a_confirm_sig TEXT,
									  created_at TEXT NOT NULL DEFAULT (datetime('now')),
	expires_at TEXT NOT NULL,
	confirmed_at TEXT
	);

-- 防止同一 B 对同一 ad 并发刷 pending
CREATE UNIQUE INDEX IF NOT EXISTS idx_claims_ad_b_pending
	ON claims(ad_id, b_x_id)
	WHERE status IN ('CLAIMED','PENDING_CONFIRM');

CREATE INDEX IF NOT EXISTS idx_claims_axid_status ON claims(a_x_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_claims_bxid_created ON claims(b_x_id, created_at);

-- B 的广告收益账本（阶段5结算时会更新）
CREATE TABLE IF NOT EXISTS ad_user_balances (
												b_x_id TEXT PRIMARY KEY,
												asset_symbol TEXT NOT NULL DEFAULT 'USDC',
												withdrawable_atomic TEXT NOT NULL DEFAULT '0',
												pending_atomic TEXT NOT NULL DEFAULT '0',
												total_earned_atomic TEXT NOT NULL DEFAULT '0',
												updated_at TEXT NOT NULL DEFAULT (datetime('now'))
	);
