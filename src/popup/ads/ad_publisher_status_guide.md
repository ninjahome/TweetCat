# 广告主广告状态说明（Publisher Campaign Status）

> 目的：把“广告状态如何变化（状态机）”以及“每个状态下广告主能做什么（按钮/接口）”讲清楚，作为产品与实现的稳定锚点。
>
> 本文描述的是**当前代码已实现的行为** + 已确定的产品决策（ended 优先、ended 不可恢复/暂停、ended 不可更新 settings）。

## 1. 状态模型：一个维度（当前）+ 两个维度（未来）

### 1.1 当前只有一个状态维度：`campaign_status`

当前前后端统一的广告状态枚举（Campaign Status）：
- `ACTIVE`
- `PAUSED_MANUAL`
- `PAUSED_NO_BUDGET`
- `EXPIRED`
- `COMPLETED`

并且需要区分：
- **持久化状态（DB 字段）**：主要是 `ACTIVE` / `PAUSED_MANUAL` / `PAUSED_NO_BUDGET`
- **派生状态（运行时计算）**：`EXPIRED` / `COMPLETED`（由 `end_date`、`quota_used/quota_total` 计算得到）

### 1.2 未来建议拆成两个维度（强烈建议）

`campaign_status` 只表达“投放/可领取”；
新增 `budget_settlement_status` 表达“冻结资金是否已扣减/退回”（避免把退款/结算语义塞进 `campaign_status` 造成混乱）。

建议枚举：
- `NOT_NEEDED`（已用完无需退）
- `PENDING`（到期待退）
- `REFUNDED`（已退回）
- `FAILED/RETRYING`（可选）

## 2. 已确定的产品决策（会影响所有按钮与逻辑）

1) **ended 优先显示**：`COMPLETED/EXPIRED` 必须覆盖手动暂停显示（ended-first）。
2) **ended 不允许恢复/暂停**：`EXPIRED/COMPLETED` 不允许 resume/pause（只读/审计）。
3) **ended 不允许更新 settings**：`EXPIRED/COMPLETED` 不允许更新 `callback_url/custom_data`。

## 2.1 这三条决策的落地状态（代码实现进度）

> 备注：本节用来确保“文档说的”与“代码真正做的”一致，方便你在重构过程中逐项对齐。

- ✅ ended-first（派生状态优先级）：`tweetcat-x402-worker/tweetcattips/src/database_ad.ts` 的 `getEffectiveStatus`
- ✅ ended 禁止更新 settings（后端兜底）：`tweetcat-x402-worker/tweetcattips/src/api_srv_ads.ts` 的 `apiAdsUpdate`
- ✅ ended 禁止更新 settings（前端禁用入口）：`src/popup/ads/ad_publisher_dashboard.ts` 的 `openAdDetailModal`
- ✅ ended 禁止恢复/暂停（后端逻辑约束）：`/ads/publisher/toggle_status` 只允许 `ACTIVE <-> PAUSED_MANUAL`（因此 ended 无法切换）
- ✅ ended 列表按钮禁用：`My Ads` 列表对 `EXPIRED/COMPLETED` 显示 `N/A`（禁用）

## 3. 状态如何变化（状态机）

### 3.1 状态变化触发条件（当前实现）

- 创建广告：进入 `ACTIVE`（前提：广告主 Ads Account `available` 余额足够，创建时会把预算 `available -> frozen`）。
- 广告主手动暂停：`ACTIVE -> PAUSED_MANUAL`
- 广告主手动启用：`PAUSED_MANUAL -> ACTIVE`
- 追加预算：不会改变状态（除非原本是 `PAUSED_NO_BUDGET`，追加成功后会 `PAUSED_NO_BUDGET -> ACTIVE`）
- 到期：任何未 ended 的广告在 `end_date < now` 时派生为 `EXPIRED`
- 完成：任何未 ended 的广告在 `quota_used >= quota_total` 时派生为 `COMPLETED`

> 注意：当前实现里 `quota_used` 是“领取时 +1”，并非“验证通过后才 +1”。这会影响你对 COMPLETED/消耗的理解（后续会按计划修正）。

### 3.2 状态机图（当前实现 + ended-first）

```text
              (pause)                     (resume)
   ┌──────────────────────────┐     ┌──────────────────────────┐
   │                          ▼     │                          ▼
ACTIVE  ─────────────────>  PAUSED_MANUAL  ────────────────>  ACTIVE
  │
  │ (quota_used >= quota_total)  -> COMPLETED   [ended]
  │ (end_date < now)             -> EXPIRED     [ended]
  │
  └─────────────────────────────────────────────────────────────

PAUSED_NO_BUDGET --(top_up_budget ok)--> ACTIVE   (仅当系统能进入该态时)
```

## 4. 每个状态下：按钮与逻辑可用性（广告主视角）

说明：
- “列表行按钮”指 `My Ads` 表格的 Actions 列。
- “详情弹窗按钮”指点击 View 后的详情弹窗。
- “追加预算”指 `/ads/publisher/top_up_budget`。
- “更新 settings”指 `/ads/publisher/update`（callback/custom_data）。

| 状态 | 含义（广告主理解） | 如何进入 | 如何退出 | 列表行按钮 | 详情弹窗按钮 | 追加预算 | 更新 settings | 是否在广场展示 |
|---|---|---|---|---|---|---|---|---|
| `ACTIVE` | 可投放、可被领取 | 创建成功 / 恢复成功 / no_budget topup 后 | 手动暂停 / 到期 / 完成 | `暂停` | `暂停广告` + `追加预算` | ✅ | ✅ | ✅（需额外满足：未过期、未满额、且 `frozen >= unit_price`） |
| `PAUSED_MANUAL` | 手动暂停（不可被领取） | `ACTIVE` 手动暂停 | 手动启用 / 到期 / 完成 | `启用` | `启用广告` + `追加预算` | ✅ | ✅ | ❌ |
| `PAUSED_NO_BUDGET` | 预算不足导致暂停（当前实现基本不可达） | （未来：结算扣减导致 `frozen < unit_price` 自动进入） | 追加预算成功后恢复为 `ACTIVE` | `充值` | `充值并启用` | ✅（topup 成功后会自动变为 ACTIVE） | ✅ | ❌ |
| `EXPIRED` | 已到期结束（ended，只读） | `end_date < now`（派生） | 无 | `N/A`（禁用） | 无（只读） | ❌ | ❌ | ❌ |
| `COMPLETED` | 任务额度用尽结束（ended，只读） | `quota_used >= quota_total`（派生） | 无 | `N/A`（禁用） | 无（只读） | ❌ | ❌ | ❌ |

## 5. 与后端接口/校验的对应关系（便于查代码）

### 5.1 广告主侧（Publisher）

- 创建广告：`POST /ads/publisher/create`
  - 校验余额：不足返回 `INSUFFICIENT_BALANCE`
  - 成功时会“锁预算”：`available -> frozen`
- 更新 settings：`POST /ads/publisher/update`
  - ✅ ended（`EXPIRED/COMPLETED`）返回 `INVALID_STATE`（已实现）
- 暂停/恢复：`POST /ads/publisher/toggle_status`
  - 仅允许 `ACTIVE <-> PAUSED_MANUAL`
- 追加预算：`POST /ads/publisher/top_up_budget`
  - ended（`EXPIRED/COMPLETED`）禁止
  - `PAUSED_NO_BUDGET` 追加成功会自动变 `ACTIVE`
- 仪表盘：`GET /ads/publisher/dashboard_info`
- 消费历史：`GET /ads/publisher/spend_history`
  - 目前只统计 `CONFIRMED/SETTLED_TIMEOUT`，但系统尚未推进到这些状态（因此可能一直为 0）
- Ads Account 入金/出金：`/ads/publisher/recharge`、`/ads/publisher/withdraw`、`/ads/publisher/ledger`

### 5.2 广场展示（Executor）

- 广告列表：`GET /ads/executor/list`
  - 仅展示满足条件的 ACTIVE 广告（还会检查未过期、未满额、`frozen >= unit_price`）
- 领取：`POST /ads/executor/claim`
  - 当前会立刻 `quota_used += 1` 并创建 claim（后续计划会把“领取”与“消耗/结算”拆开）

## 6. 常见困惑与解释

### 6.1 为什么 ended 要优先于手动暂停？

如果一个广告已经到期或额度用尽，它客观上已经“结束”，不应该再显示为“Paused”，否则广告主会误判“还能恢复继续投放”。

### 6.2 为什么现在 `PAUSED_NO_BUDGET` 看不到/进不去？

因为当前实现中冻结资金（`frozen_atomic`）不会随任务结算减少；系统也没有“预算不足自动暂停”的逻辑，所以不会自然进入该状态。
一旦后续实现“结算扣减 frozen + 预算不足自动暂停”，`PAUSED_NO_BUDGET` 才会成为正常状态。

### 6.3 ended 不允许更新 settings 的目的是什么？

避免 ended 广告在数据层继续变化（尤其涉及回调/自定义数据），让“结束后只读”成为稳定规则，降低审计复杂度与产品歧义。

## 7. 后续重构清单（把状态锚点彻底做“稳定”）

> 这里列的是“为了让本文长期成立”必须做的重构点（不是一次性全做完，按优先级推进）。

### P0（优先级最高）：修正“领取=消耗”的口径错误

- 将 `/ads/executor/claim` 从“立即 `quota_used += 1`”改为“仅创建 claim，不计入完成/消耗”。
- 增加可解释口径：
  - `claimed_count`（领取数）
  - `confirmed/settled_count`（验证通过/已发放数）
  - `spent_atomic`（真实消耗）
- 广告主 UI（My Ads + Dashboard + Spend History）全部改用“已确认/已结算”口径，避免广告主误判。

### P1：把资金结算/退款从 `campaign_status` 拆出去（第二维度）

- 新增 `budget_settlement_status`（或等价设计），用来表达：
  - 到期后是否需要退回冻结资金
  - 是否已退回/退回失败
- 引入“冻结扣减（SPEND）”与“到期退回（REFUND）”的账本/聚合字段，否则 `PAUSED_NO_BUDGET` 与“到期两种状态”无法成立。

### P2：让 `PAUSED_NO_BUDGET` 成为真实可达状态（否则它只是常量）

- 在“真实结算扣减 frozen”落地后：
  - 当 `frozen < unit_price_atomic` 时自动置 `PAUSED_NO_BUDGET`
  - top-up 成功后自动恢复 `ACTIVE`
