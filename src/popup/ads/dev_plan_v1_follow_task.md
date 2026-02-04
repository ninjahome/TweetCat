
## 补充方案：高价值广告任务的 Evidence 存证（条件可信）

### 目标与阶段划分

我们将“奖励发放证明”拆成两个阶段：

1) **当前阶段（本期实现）**：不做服务器签名、不做多客户端投票，只将任务相关的 **Evidence（证据摘要）** 写入数据库，供广告主后续审计与抽查。
2) **后续阶段（规划）**：服务器对任务生成签名并下发给随机挑选的浏览器客户端做二次验证；当随机抽取的 3 个客户端中有至少 2 个确认任务真实，则任务最终确认为真实。

### Evidence 存证的基本规则

- **只对高价值动作生成**：例如与奖励发放直接相关的关键任务（claim/withdraw/关键行为核验等）。
- **一任务一次**：同一个广告任务只允许生成一次 Evidence，多次提交视为无效（通过数据库唯一约束/幂等逻辑保证“最多一次生效”）。
- **最小化存储**：只保存“部分响应字段 + 哈希”，避免保存完整响应内容带来的隐私与存储成本。

### Evidence 建议包含的字段（示例）

以下字段用于证明“扩展在某时刻观察到某次请求/响应，并将其以不可篡改方式提交到服务器存证”：

- **任务标识**：`task_id`（或 `claim_id`）、`ad_id`、`b_x_id`、`a_x_id`
- **请求绑定（canonical）**：
  - `method`
  - `htu = origin + pathname`（不含 query/fragment）
  - `request_body_sha256`（如需）
- **响应摘要**：
  - `status`
  - `response_body_sha256`
  - `response_fields`（仅保存与任务判断直接相关的少量字段）
- **设备侧不可抵赖字段**：
  - `iat`（秒级时间戳）
  - `jti`（一次性随机 ID）
  - `device_jkt`（服务端从绑定的 `device_pubkey_spki` 计算得到的 thumbprint）
  - `device_signature`（Device Key 对 canonical request/response 摘要签名）

### 为什么“扩展观察到的 x.com 返回结果”在很大程度上是可信的（条件可信）

在 **浏览器与电脑本身没有被攻克**、扩展代码未被篡改的前提下，我们通过以下机制把“刷奖励/伪造证据”的成本抬到很高：

1) **一设备一密钥（Device Key）**：关键证据必须由本地不可导出的 Device Key 签名，服务器只接受与用户绑定的设备公钥验签通过的 Evidence。
2) **强制验签的关键 API**：服务器对高价值写接口强制校验签名输入（canonical request + bodyHash），杜绝“随便构造 HTTP 请求就能伪造证据”的情况。
3) **抗重放（jti 去重 + iat 时间窗）**：
   - `iat` 必须在允许窗口内（过期/未来漂移直接拒绝）
   - 同一设备在短 TTL 窗口内的 `(device_jkt, jti)` 只能生效一次（重复直接拒绝）
   这能有效抵御录包重放与并发重放。
4) **Coinbase 社交账号强绑定**：Evidence 与已登录态的用户身份绑定；攻击者想要刷奖励，必须在真实浏览器环境中安装正式扩展并完成账号登录/绑定，再满足上述签名与防重放约束。

在满足上述条件后仍要“刷奖励”，将需要付出极高的人力与环境成本（真实浏览器 + 正式扩展 + 登录绑定 + 通过签名与防重放约束）。对于这种“高成本、近似终端已被控制/人为操作”的场景，我们将其视为超出当前系统安全目标的范围（后续阶段会引入随机客户端复核进一步抬高成本与提高可审计性）。


---

## 待办清单：未实现 / 不合理 / 错误实现（按步骤可落地）

下面清单以 **Follow 激励任务** 为主线，把当前代码里“尚未实现的、实现口径不合理的、实现方式错误/会导致状态不可达”的点汇总，并给出一个可以逐步落地的路线图（从最小可用到完整闭环）。

### 0. 现状对照（需要先统一口径）

1) **“Claim/领取”不等于“任务完成/消耗/发放”**  
   - 现状：执行者调用 `/ads/executor/claim` 会立刻 `quota_used += 1` 并写入 `ad_reward_claims`（状态 `CLAIMED`）。  
   - 问题：这会把“领取”当成“已消耗”，导致广告主侧 `Spent/Remaining` 与真实发放脱节，也会让“到期退款/冻结扣减”无法正确实现。

2) **冻结资金（`frozen_atomic`）只增不减，导致 `PAUSED_NO_BUDGET` 基本不可达**  
   - 现状：创建/追加预算会 `available -> frozen`，但没有任何逻辑在任务发放时从 `frozen` 扣减，也没有到期/结束时退回。  
   - 结果：后端的 `PAUSED_NO_BUDGET` 状态虽然存在，但系统不会自然进入；同时“预算退回/未退回/无需退回”这类你关心的状态分叉目前根本没有数据基础。

3) **广告主 Dashboard 的“今日/7日花费/消费历史”口径目前无法产生数据**  
   - 现状：Dashboard 的统计只统计 `ad_reward_claims.status IN ('CONFIRMED','SETTLED_TIMEOUT')`，但当前没有任何代码把 claim 状态推进到这些状态。  
   - 结果：Dashboard 花费会长期为 0（即使有人领取/刷 claim）。

4) **广告状态优先级可能不符合直觉**  
   - 现状：`getEffectiveStatus` 优先返回 `PAUSED_MANUAL`，即使已经到期，也会显示“Paused”而不是“Expired”。  
   - ✅ 已决策：**ended（EXPIRED/COMPLETED）优先显示**，不应被手动暂停掩盖（否则广告主会误判还可以继续投放）。

### 0.1 广告主状态与可操作按钮：现状（代码里现在就是这样）

当前广告状态常量（前后端一致）：
- `ACTIVE` / `PAUSED_MANUAL` / `PAUSED_NO_BUDGET` / `EXPIRED` / `COMPLETED`

状态来源说明（非常关键）：
- **持久化状态（DB 字段）**：目前主要会出现 `ACTIVE`、`PAUSED_MANUAL`（你可以把它理解为“广告主可切换的开关”）。
- **派生状态（运行时计算）**：`EXPIRED`、`COMPLETED` 是通过 `end_date` 与 `quota_used/quota_total` 计算出来的“逻辑状态”。
- **`PAUSED_NO_BUDGET`**：目前没有自动进入该状态的逻辑（因为 `frozen_atomic` 不会随结算减少；也没有“预算不足自动置暂停”的流程）。

广告主页面按钮现状（不讨论未来资金结算/退款，纯当前 UI/后端规则）：

| 广告状态 | 列表行按钮（Actions） | 详情弹窗额外按钮 | 允许追加预算 | 允许更新 callback/custom_data |
|---|---|---|---|---|
| `ACTIVE` | `暂停` | `暂停广告` + `追加预算` | ✅（`/ads/publisher/top_up_budget`） | ✅（`/ads/publisher/update`） |
| `PAUSED_MANUAL` | `启用` | `启用广告` + `追加预算` | ✅ | ✅ |
| `PAUSED_NO_BUDGET` | `充值` | `充值并启用` | ✅（且后端会把 `PAUSED_NO_BUDGET -> ACTIVE`） | ✅ |
| `EXPIRED` | `N/A`（禁用） | 无 | ❌（后端禁止 ended ads top up） | ❌（✅ 已决策：ended 不允许更新） |
| `COMPLETED` | `N/A`（禁用） | 无 | ❌（后端禁止 ended ads top up） | ❌（✅ 已决策：ended 不允许更新） |

> 注：`EXPIRED/COMPLETED` 在当前实现里，更多是“前端禁用操作 + 后端阻止 top-up”的组合，而不是一个完整的“结束结算态”。

### 0.2 建议现在就把“状态锚点”定清楚（否则后续实现会越写越乱）

建议：**不要等到最后再整理**。原因是后续你要做的 Follow 验证、结算打款、到期退款、广告主报表，全部都会引用“状态判断 + 可操作按钮”，如果锚点不稳定，会导致：
- API/DB 里同一个字段被迫承载多个含义（投放、结算、退款），越改越难；
- 前端按钮逻辑需要反复返工；
- 广告主看见的“Spent/Remaining/Ended”会频繁变更口径，体验会崩。

建议的状态锚点模型（最小清晰版本）：
1) `campaign_status`（投放/可领取维度）：仍用现有 5 个足够表达“可投放/暂停/到期/完成”。  
2) `budget_settlement_status`（资金结算维度，新增）：专门表达“冻结资金是否已经扣减/退回”，不要塞进 `campaign_status`。  
   - 推荐枚举：`NOT_NEEDED`（已用完无需退）、`PENDING`（到期待退）、`REFUNDED`（已退回）、`FAILED/RETRYING`（可选）。

关键决策点（需要你拍板，拍板后才能让按钮逻辑稳定）：
- ✅ 已决策：到期/完成 **覆盖** 手动暂停显示（ended 优先）
- ✅ 已决策：`EXPIRED/COMPLETED` **不允许** “恢复/暂停”（只允许查看与审计）
- ✅ 已决策：ended **不允许** 更新 `callback/custom_data`

落地要点（需要配套实现，否则“决策”不会在产品里生效）：
- 后端：`/ads/publisher/update` 在广告 `EXPIRED/COMPLETED` 时返回 `INVALID_STATE`（或 `AD_ENDED`）。
- 前端：Ad Detail 弹窗在 `EXPIRED/COMPLETED` 时禁用输入框并隐藏/禁用 “Update Settings” 按钮；列表/弹窗不提供 Pause/Resume 入口（当前列表已禁用，但需保证弹窗也不生成）。
- 状态计算：调整 `getEffectiveStatus` 的优先级，让 `COMPLETED/EXPIRED` 覆盖 `PAUSED_MANUAL`（同时定义好“快到期但手动暂停”的展示文案）。

### 1. 分步实现路线图（建议按顺序）

#### Step 1：把“领取”和“消耗/发放”彻底拆开（修正不合理口径）

- 后端：把 `/ads/executor/claim` 从“立即消耗 quota_used”改为“创建待验证的 claim（不消耗预算）”。  
  - 变更点：将 `incrementAdQuota(...)` 迁移到“验证通过/最终结算”之后执行，或引入独立字段 `quota_claimed`/`quota_confirmed`。  
- 前端：广告主侧 `Spent/Remaining/Completed` 不再以 `quota_used` 作为“消耗已发生”的口径；在未实现结算前可以临时展示 `claimed_count`，并明确标注“待验证/待结算”。

#### Step 2：补齐 Follow 任务的 Evidence/Proof 提交与存证（未实现）

- 新增 API：执行者提交证据（Proof/Evidence）  
  - 建议路径：`/ads/executor/submit_evidence` 或 `/ads/executor/submit_proof`（POST，强制设备签名 + 防重放）。  
- 新增表：`ad_task_evidence`（或扩展 `ad_reward_claims`）保存你在本文前半部分定义的最小化字段：`claim_id/ad_id/b_x_id/a_x_id` + canonical request/response hash + iat/jti/jkt + device_signature + created_at。  
- 前端（执行者）：完成关注后调用 submit 接口；失败可重试，但需要“最多一次生效”的幂等约束。

#### Step 3：实现 Follow 验证（未实现）

- 定义验证策略（先选一个能落地的最小版本）：  
  - A) 服务器侧通过 X/Twitter API 验证关注关系（需要处理 rate limit/权限/一致性延迟）。  
  - B) 先做“弱验证 + 抽查”：只做格式/签名校验，状态进入 `PENDING_CONFIRM`，后续异步抽查或人工审计。  
- 在后端引入 claim 状态流转：`CLAIMED -> PENDING_CONFIRM -> CONFIRMED / REJECTED`（并记录 `reject_reason`）。

#### Step 4：实现“预算消耗/冻结扣减/执行者发放”的结算闭环（未实现）

这一步是把资金状态做正确的关键，否则广告主状态永远无法解释清楚。

- 新增“消耗记账”维度（强烈建议不要塞进 `AdCampaignStatus`）：  
  - 方案 A：扩展 `ad_escrow_ledger` 增加 `op`（RESERVE/SPEND/REFUND/…），并记录 `ad_id/claim_id`，做全量账本。  
  - 方案 B：增加 `ad_campaign_budget`（按广告维度记录 `locked_atomic/spent_atomic/refunded_atomic`），账本作为可选。  
- 结算动作（当 claim `CONFIRMED` 时）：  
  - `frozen_atomic -= unit_price_atomic`（预算真实消耗）  
  - 写入“消耗/发放”记录（用于广告主报表与审计）  
  - 给执行者打款（链上或平台内余额，二选一；链上可复用 `internalTreasurySettle` 思路）  
  - 可选：触发广告主 `callback_url` 回调（包含 `custom_data`）

#### Step 5：实现“到期/结束后的资金解冻与可解释状态”（你当前最关心的点）

你提到到期至少有三种情况：已退回/未退回/无需退回（用完）。这需要一个独立的结算状态。

- 建议新增 `refund_status`（或 `budget_settlement_status`），与 `AdCampaignStatus` 解耦：  
  - `NOT_NEEDED`：已完全消耗（spent == locked）  
  - `PENDING`：到期但未退回（需要执行 refund job）  
  - `REFUNDED`：已退回（locked - spent 已回到 available）  
  - `FAILED`/`RETRYING`（可选）：退款失败可重试  
- 实现方式：  
  - A) 定时任务（cron/queue）扫描到期广告，计算可退金额并执行 `frozen -> available`。  
  - B) 惰性结算：广告主查询广告/列表时触发“到期退款结算”（要小心并发与幂等）。

#### Step 6：把广告主 UI 的状态/统计彻底对齐新的口径（避免“看起来错”）

- My Ads 列表：  
  - Completed：用 `confirmed_count`（或 `settled_count`）而不是“领取数”。  
  - Spent：用 `spent_atomic`（真实结算）而不是 `quota_used * unit_price`。  
  - Remaining Budget：用 `locked - spent - refunded` 或者 `campaign_budget.remaining_atomic`。  
- Dashboard：  
  - today/week spend：从“已结算”口径聚合（并确保状态机能推进到这些状态）。  
- History：  
  - 分开展示：充值/提现账本、广告消耗账本、退款账本（或合并为统一账本但用 op 区分）。

#### Step 7：补齐风控与并发正确性（避免刷与竞态）

- 幂等：submit proof / confirm / settle 都要有明确 idempotency key（避免重复扣 frozen 或重复打款）。  
- 并发：同一广告/同一执行者的重复领取、重复提交、重复确认要可控；必要时在 DB 层加唯一约束。  
- 领取过期：claim 需要 `expires_at`（Follow 任务窗口），过期后自动 `SETTLED_TIMEOUT` 或 `REJECTED`（按产品定义）。

#### Step 8：清理/补齐当前实现中的“小错误/不一致”（可穿插做）

- `PAUSED_NO_BUDGET`：要么实现“frozen 随结算减少 + 自动置 no_budget”，要么先移除前端入口避免误导。  
- `/ads/executor/claim` 请求体里前端传了 `b_wallet`，后端目前不使用；需要决定是否保留并入表/校验。  
- `getEffectiveStatus` 的优先级：决定到期是否应覆盖手动暂停的展示（影响广告主理解）。
