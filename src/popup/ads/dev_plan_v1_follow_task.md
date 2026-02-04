
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


---

## 进度更新：当前状况 & 下一步工作（Follow v1）

### 当前已完成（可工作的部分）

1) **广告主状态锚点已拍板并部分落地**
   - ended（`EXPIRED/COMPLETED`）优先显示（覆盖手动暂停）
   - ended 不允许恢复/暂停（只读/审计）
   - ended 不允许更新 `callback_url/custom_data`

2) **Ads Account 托管账户与“锁预算（available → frozen）”已存在**
   - 发布广告时会锁预算（`reserveAdBudget`）
   - 充值/提现/账本查询可用（Ads Account 维度）

3) **“领取占位”已实现，但“任务完成/验证/发放”仍未实现**
   - 当前 `/ads/executor/claim` 的行为：创建 claim + `quota_claimed += 1`（占位），不会产生真实消耗/发放
   - 前端 My Ads 表格已对齐口径：新增 `Settled` 列；`Claimed` 与 `Spent/Settled` 分离（避免把领取当消耗）

> 注意：本期我们引入了 `ad_campaigns.quota_claimed`。如果 dev DB 只重置了 `ad_campaigns`，需要确保该列存在且默认值为 0，否则 claim/list 查询会异常。

### 当前仍缺失（导致“无法完整测试”的核心原因）

1) **Proof/Evidence 提交（执行者 -> 服务器）缺失**
   - 执行者执行关注后，尚无“提交证据”API/数据模型

2) **Follow 验证缺失**
   - 服务器尚未验证关注关系（或弱验证/抽查策略）
   - `ad_reward_claims` 状态无法推进到 `PENDING_CONFIRM/CONFIRMED/REJECTED`

3) **结算与发放缺失**
   - 未实现：`frozen_atomic` 扣减（SPEND）、执行者打款、广告主回调、平台费
   - 导致：Dashboard 的 today/week spend、spend_history 目前长期为 0（因为它统计的是已确认/已结算）

4) **到期/完成后的预算退回（解冻）缺失**
   - 未实现：到期后把剩余冻结资金退回 available（REFUND）
   - 因此：你关心的“到期已退/未退/无需退（用完）”目前无法形成真实状态

### 下一步工作建议（先把闭环做出来，再做完整测试）

#### Phase 1：让 Follow v1 形成最小闭环（必须先完成）

1) **新增 Evidence/Proof 提交链路**
   - 新增 API：`/ads/executor/submit_proof`（或 `submit_evidence`）
   - 新增表：存证最小字段（claim_id/ad_id/b_x_id/a_x_id + canonical/hash + iat/jti/jkt + device_signature）
   - 约束：幂等（同一 claim 只能提交一次有效 evidence）

2) **实现最小验证策略（先能跑通）**
   - v1 建议：先做“弱验证 + 抽查/延迟验证”模型
   - claim 状态流转：`CLAIMED -> PENDING_CONFIRM -> CONFIRMED/REJECTED`

3) **实现最小结算（资金与数据必须一致）**
   - 当 `CONFIRMED`：
     - `frozen_atomic -= unit_price_atomic`（真实消耗）
     - 记录 spend（用于广告主报表）
     - 执行者打款（链上或平台内余额二选一；链上可复用 treasury settle 思路）
     - 可选：触发广告主 `callback_url` 回调（带 `custom_data`）

#### Phase 2：到期/完成后的预算退回（你关心的状态分叉）

4) **引入 `budget_settlement_status`（第二维度）**
   - `NOT_NEEDED` / `PENDING` / `REFUNDED` / `FAILED(RETRYING)`
   - ended（EXPIRED/COMPLETED）与 refund 状态解耦，避免把“投放结束”与“资金结算完毕”混成一个枚举

5) **实现 REFUND 机制（cron 或惰性结算）**
   - 到期时计算可退金额：`locked - spent`
   - 执行 `frozen -> available` 并记录账本/状态

#### Phase 3：补齐广告主 UI 统计与对账（让完整测试有意义）

6) **广告主 UI 口径全面收敛到“已结算”**
   - My Ads：`Claimed`（占位）/`Settled`（已结算）/`Spent`（已结算支出）/`Remaining`（按 claimed 或按 locked-spent-refund 选一种口径并写清楚）
   - Dashboard：today/week spend 与 spend_history 对齐 claim 结算记录

### 当前阶段可测试范围（现实可测）

- ✅ 发布广告 / 锁预算 / 暂停恢复 / 追加预算（不改价） / 充值提现 / ended 只读限制 / `claim` 占位
- ❌ Follow 完成证明、服务器验证、真实发放、真实消耗与退款（需 Phase 1/2 完成后才能完整测）


---

## Proof（submit_proof）方案讨论：产生过程、按广告类型的证据、可信度

> 目的：在动手实现 `submit_proof` API/表之前，把“Proof 怎么产生、不同广告类型怎么做、可信度与边界是什么”先定清楚，避免做完接口后发现证据无法生成或不可验证。

### 我们现在有多少个广告类型？

当前代码里的广告类型（前后端一致）共有 **4 种**：
- `follow`
- `visit`
- `register`
- `share`

对应定义位置：
- 前端：`src/popup/ads/ad_plaza.ts`、`src/popup/ads/ad_publisher_ads.ts`
- 后端：`tweetcat-x402-worker/tweetcattips/src/database_ad.ts`（`export type AdCategory = "follow" | "visit" | "register" | "share";`）

> 但本期 v1 的闭环只聚焦 `follow`，其他类型只做方案占位（避免接口设计被后续扩展卡死）。

### Proof 的产生过程（我们怎么理解）

以 Follow 任务为例，推荐的“最小可用”流程如下：

1) **Claim（领取占位）**：执行者在广场点击 Start Task，服务器创建 claim（`CLAIMED`），并给出 `claim_id` + 任务上下文（ad_id、target、deadline 等）。
2) **执行动作（浏览器端）**：用户在 x.com 页面完成 follow。
3) **扩展生成 Proof**：扩展在用户动作前/后采集“可验证的观察数据”，做 hash 摘要，并使用 Device Key 进行签名（含 iat/jti 防重放）。
4) **submit_proof**：扩展把 proof payload 发到服务器（强制设备签名 + 幂等），服务器写入 evidence 表，并把 claim 状态推进到 `PENDING_CONFIRM`（或先保持 `CLAIMED`，看策略）。
5) **验证（异步）**：服务器对 proof 做轻量校验（签名/时间窗/幂等），并按策略做“弱验证/抽查/强验证”，最后推进到 `CONFIRMED/REJECTED`。
6) **结算**：`CONFIRMED` 时扣减 frozen、记账、发放奖励（后续阶段）。

### 每种广告类型，Proof 应该如何生成（方案）

#### A) follow（本期要实现）

**目标：证明“执行者在某一时刻观察到自己已关注目标账号”。**

推荐 v1 证据来源（无需先拦截 Follow Mutation，先用“关注后页面数据可观测”）：
- 利用扩展已存在的 injection 能力抓取 `UserByScreenName` GraphQL 响应（当前用于抓 profile/timeline）：`src/inject_tweet_fetch.ts`
- 关注动作完成后，页面会触发 profile 查询；响应里通常包含 `following: true`（你仓库里也有类似字段样例：`src/object/Phyrex_Ni.json`）。

v1 proof payload（最小字段集合，偏“可审计 + 可复核”）：
- 业务标识：`claim_id`、`ad_id`、`a_x_id`、`b_x_id`
- 任务上下文：`category="follow"`、`target_screen_name`（或 target user id）
- 观察数据摘要（不存全量隐私）：  
  - `htu`（例如 `https://x.com/i/api/graphql/.../UserByScreenName` 的 origin+pathname，不含 query）
  - `request_body_sha256`（variables/features 的 canonical body hash，可选）
  - `response_body_sha256`
  - `observed_fields`（最少字段：`target_rest_id`、`target_screen_name`、`following=true`、`observed_at`）
- 不可抵赖字段：`iat`、`jti`、`device_jkt`、`device_signature`

v1 验证策略（先跑通）：
- **弱验证**：服务器只验签/验时间窗/验幂等/验 claim 归属；将 claim 推进到 `PENDING_CONFIRM`（不立即发钱）。
- **抽查/延迟验证**（后续）：服务器随机抽部分 `PENDING_CONFIRM`，用 X API 或其它方式复核 follow 关系，再推进到 `CONFIRMED/REJECTED`。

> 为什么不用“拦截 follow 请求本身”作为 v1？  
> 可以做，但 X 的 follow 动作可能走多种 endpoint/GraphQL mutation，且实现细节变动快。v1 用 profile 查询响应作为 proof 来源更稳，落地成本更低。

#### B) visit（占位）

目标：证明“用户确实访问并停留在某个 URL/域名”。

可选证据源（从弱到强）：
- 弱：扩展记录 tab 激活 + URL + dwell time（容易被脚本刷，审计价值有限）。
- 中：记录目标页面关键资源请求（fetch/XHR）摘要（对抗纯前端伪造稍好）。
- 强：需要站点配合（callback/签名挑战），或 TLS/ATA 类方案（超出 v1）。

建议：visit 在 v1 先不实现结算，仅保留接口/数据模型的可扩展性。

#### C) register（占位）

目标：证明“用户在第三方站点完成注册/绑定”。

最可行证据：**广告主 callback**（站点服务端回调平台，平台验签/验 nonce）。  
纯浏览器端 proof 很难做到可验证（除非站点配合挑战签名）。

建议：register 必须走 callback 体系，submit_proof 只是补充审计，不做唯一凭证。

#### D) share（占位）

目标：证明“用户完成 retweet/quote/分享指定 tweet”。

可选证据源：
- 拦截 retweet/quote 的 GraphQL mutation 或 API 返回（比 follow 更容易受版本变化影响）。
- 或在动作后抓取 TweetDetail/用户时间线响应，观察 “retweeted/quoted” 状态（类似 follow 的思路）。

建议：share v1 先采用“动作后抓取 tweet detail 状态”的思路，避免依赖 mutation 细节。

### 我们现在扩展生成的 proof 是否足够可信？

结论：**在“条件可信”模型下足够作为 v1 的存证与后续抽查依据**，但不应直接作为“立即发钱”的唯一依据。

理由（基于现有能力）：
- 扩展已经有 **Device Key 签名 + iat/jti 防重放** 的基础设施（用于 server API 签名），同样可以用于 proof payload。
- 扩展已有注入脚本可观测 x.com 的 GraphQL 响应（`src/inject_tweet_fetch.ts`），可以拿到“关注后 profile 状态”这类信号。

边界与风险：
- 如果用户本机/浏览器被深度控制，或扩展被篡改，仍可能伪造观察数据（这是“终端被攻克”问题，v1 不解决）。
- 因此推荐策略是：proof 先入库 + 状态进入 `PENDING_CONFIRM`，后续通过抽查/多客户端复核/站点回调等方式提升可信度，再结算。


---

## 【关注即领 X USDC】按钮：发现机制与缓存/版本策略（实现步骤 1~6）

> 目标：让“执行者”在进入广告主的 X 主页时（不论是否从广告广场跳转而来），都能稳定发现并执行 follow 广告；同时避免在非主页/非广告主页面乱插按钮。

### 1) 强制 follow 广告落地页为广告主主页（先简单走）

**规则（v1 强制）：**
- follow 广告的 `detail_url` 必须是 `https://x.com/<advertiser_username>`（可选兼容 `twitter.com`，最终统一归一化为 `x.com`）。
- 如果未来要支持“非主页落地页”，需要新增“URL->广告主身份映射/校验逻辑”（记录为后续 backlog）。

**原因：**
- content script 在 profile 页只需要用当前 URL 去查本地 cache，即可判断是否存在 follow offer，无需在前端做复杂映射。

### 2) 执行前先检查是否已关注（利用 inject 的 profile 数据）

**规则（v1）：**
- 进入 profile 页后，不直接 claim；先判断“当前用户是否已关注该主页账号”。
- 优先利用 inject 环境捕获到的 profile 数据（你提到的 `src/inject_*` 相关机制）来获得 `following` 等字段。

**好处：**
- 减少无意义 claim（已关注的人不需要再显示“关注即领”）。
- 可以把按钮 UI 状态做得更清晰：未关注可领、已关注不可领/提示、处理中等。

### 3) background 轮询“广告广场版本号”，只在变化时拉全量广告（你的方案）

**基本思路：**
- background 里起定时器，只轮询一个轻量接口：`/ads/executor/version`（返回 `version`）。
- 若 `version` 未变：不拉 `/ads/executor/list`。
- 若 `version` 变了：拉 `/ads/executor/list`，更新本地 cache。

**关键注意点：时间驱动变化（到期）**
- 广告到期（`end_date`）是“纯时间变化”，可能不会触发任何写操作。
- 如果只靠“写操作才 bump version”，客户端可能会在 `version` 不变的情况下继续展示已过期广告。

因此这里有两种实现方式（可组合）：

- 方案 A：`version + next_invalidation_at`（我之前建议的方式）  
  - `/ads/executor/version` 返回 `version` 以及 `next_invalidation_at`（当前可展示广告里最早的 end_date）。
  - 客户端如果 `now >= next_invalidation_at`，即使 `version` 未变，也强制拉一次 `/ads/executor/list`。

- 方案 B：用 worker 的 cron 能力“定时 bump version / 更新元信息”（你提议的方式）✅ 我同意  
  - cron 每分钟（或更细粒度可用的最小间隔）运行：
    - 计算当前“下一次时间无效点”（最早 end_date）
    - 如果发现“已跨过无效点”或“最早 end_date 发生变化”，则 bump `version`（并更新 meta）
  - 这样客户端只轮询 version 也能最终收敛，但精度受 cron 周期影响（通常会有 0~1min 的延迟）。

> 推荐：v1 可以优先采用 cron（简化客户端逻辑），但我建议仍保留 `next_invalidation_at` 字段作为兜底与优化（防止 cron 触发延迟/偶发丢失导致的长时间陈旧）。

### 4) 本地 cache 为主：决定“是否插按钮”；执行时以服务器为准

**cache 内容：**
- 以 `detail_url`（归一化后的 `https://x.com/<username>`）作为 key，缓存该主页的 follow offer（建议只保留“最优一条”，比如 reward 最大/最早到期）。

**使用原则：**
- 展示按钮时：只看本地 cache（不打服务器，避免泄露浏览轨迹 & 提升性能）。
- 用户点击执行时：以服务器为准（调用 `/ads/executor/claim` 或未来的执行接口），并根据结果及时刷新 cache/按钮状态。

### 5) content script 插入逻辑（只在广告主主页 + cache 命中时插）

仅当满足以下条件才插入：
- 站点为 `x.com`（或兼容 `twitter.com`）
- URL 形态为 profile 主页（`/^\\/[^\\/]+\\/?$/`）而非 tweet、followers、following、search 等页面
- DOM 确认是 profile header/toolBar（避免误判）
- background cache 命中该主页的 follow offer
- inject 数据显示“未关注”或“未知”（若已关注则不显示或显示 disabled 状态）

### 6) 按钮 UI 状态（4 态）与点击行为（v1）

建议保留 4 种 UI 状态（你认可的那套）：
1) 无 offer：不显示
2) 有 offer，但用户未登录/未绑定：disabled，提示 “Sign in to claim”
3) 有 offer，未关注：显示 “关注即领 X USDC”
4) 已领取/处理中：显示 “处理中/已领取”（并可提示稍后查看）

点击行为（v1 建议）：
- 如果 inject 显示已关注：直接提示“已关注，无法领取/无需领取”
- 未关注：引导用户完成 follow（或监听 follow 后的 profile 数据变化），然后再调用 `/ads/executor/claim` 进行领取占位（后续会接 `submit_proof`）
- claim 成功/返回 existing：按钮进入“处理中/已领取”，并触发 background 立即刷新 cache（或最少把该 offer 标记为不可再领）
