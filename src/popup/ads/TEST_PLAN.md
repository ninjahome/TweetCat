# TweetCat 广告系统 —— 业务逻辑审查 & 综合测试计划

> **文档版本**: v1.0  
> **日期**: 2026-02-22  
> **范围**: `src/popup/ads/*`, `src/content/*`, `src/service_work/*`, `tweetcat-x402-worker/tweetcattips/src/*`

---

## 目录

1. [系统架构概览](#1-系统架构概览)
2. [设计缺陷与代码缺陷分析](#2-设计缺陷与代码缺陷分析)
3. [测试计划总览](#3-测试计划总览)
4. [模块一：广告主发布广告](#4-模块一广告主发布广告)
5. [模块二：广告主资金管理（充值 / 提现）](#5-模块二广告主资金管理充值--提现)
6. [模块三：广告生命周期管理（暂停 / 启用 / 结束 / 充值预算）](#6-模块三广告生命周期管理暂停--启用--结束--充值预算)
7. [模块四：用户执行广告（关注任务流程）](#7-模块四用户执行广告关注任务流程)
8. [模块五：任务结算与奖励（Cron 定时任务）](#8-模块五任务结算与奖励cron-定时任务)
9. [模块六：用户领取 / 提现奖励](#9-模块六用户领取--提现奖励)
10. [模块七：安全性与签名验证](#10-模块七安全性与签名验证)
11. [模块八：Content Script 按钮与 UI 交互](#11-模块八content-script-按钮与-ui-交互)
12. [模块九：Service Worker (Background) 消息路由与权限控制](#12-模块九service-worker-background-消息路由与权限控制)
13. [模块十：广告 Feed 同步与缓存](#13-模块十广告-feed-同步与缓存)
14. [模块十一：边界条件与并发场景](#14-模块十一边界条件与并发场景)
15. [模块十二：回归与集成测试](#15-模块十二回归与集成测试)

---

## 1. 系统架构概览

```
┌─────────────┐       ┌──────────────┐       ┌──────────────────────┐
│  Popup UI   │       │ Content Script│       │  Service Worker (BG) │
│ (Executor/  │◄─────►│ (twitter_ui,  │◄─────►│  (bg_msg, bg_ads_*,  │
│  Publisher)  │       │  main_entrance│       │   bg_blue_v, ...)    │
└──────┬──────┘       └──────┬───────┘       └──────────┬───────────┘
       │                     │                          │
       │                     │                          │
       ▼                     ▼                          ▼
┌──────────────────────────────────────────────────────────────────┐
│                  Cloudflare Worker (tweetcat-x402-worker)        │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────────┐   │
│  │ api_srv_ads  │  │ database_ad  │  │ cron_ads_expire/      │   │
│  │ (REST API)   │  │ (D1 SQLite)  │  │ settle/refund         │   │
│  └─────────────┘  └──────────────┘  └───────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

### 核心流程

| 角色 | 关键流程 |
|------|----------|
| **广告主 (Publisher)** | 充值 → 发布广告(预留冻结) → 管理广告(暂停/启用/结束) → 追加预算 → 提现 |
| **用户 (Executor)** | 浏览广告 → 访问KOL主页 → 点击「关注即领」→ 原生关注按钮 → 拦截确认 → 二次验证(ProfileSpotlights) → 提交证据+蓝V签名 → 等待结算 → 领取奖励 |
| **服务器 (Worker)** | 接收Claim → 验证蓝V签名 → 验证关注证据 → 原子占位 → 延迟结算(Cron 24h) → 扣冻结/增余额 → 广告到期/满额退款 |

---

## 2. 设计缺陷与代码缺陷分析

### 🔴 严重设计缺陷 (Critical)

#### C-1: [✅ 已修复] `bg_ads_follow.ts` 中的 `claimAdsFollowOffer` 不传递蓝V证据和关注证据

**修复方案**: 已将 `claimAdsFollowOffer` 标记为 `@deprecated`。对于旧的 `MsgType.AdsFollowClaim` 消息，在 `bg_msg.ts` 中做了硬拒绝并返回错误提示，强制客户端统一使用自带验证和证据收集能力的 `verifyFollowAndClaim` 流程。

**验证测试**: 
- 旧路径调用 AdsFollowClaim → 返回清晰的废弃信息，阻断提交流程。
- 新路径 AdsFollowVerifyAndClaim → 正常提交包含 `proof_data`、`blue_v_proof` 的数据，并进入等待确认状态。

---

#### C-2: [✅ 已修复] 广告主提现 (`ad_executor_summary.ts`) 使用了错误的 API 和计算逻辑

**修复方案**: 不再根据本地 claims (SUM CONFIRMED) 计算可提现金额。后端已修改 `getPerformerDashboardStats`，使其直接查 `ad_escrow_accounts` 中由 settlement 更新的真实 `available_atomic`。前端调用提现接口时，直接取服务器返回的实际值。

**验证测试**: 
- Executor 产生 CONFIRMED 收益后提现 → 操作成功，调用链上转账。
- 提现成功后再次操作 → 提现按钮被禁用，或者因为剩余 atomic 余额不足以提现而由服务端正确拒绝并提示。

---

#### C-3: [✅ 已修复] `quota_claimed` 被拒绝后不退回，导致配额永久占用

**修复方案**: 修改了 `database_ad.ts` 中的 `rejectAdReward` 函数，使用 `db.batch` 事务：一是将 claim 状态变更为 REJECTED 并记录原因；二是同时从 `ad_campaigns` 中释放占用配额 `quota_claimed -= 1`。

**验证测试**: 
- `quota_total=5`，且已有 5 个 PENDING_CONFIRM，此时新用户无法 claim。
- Cron或管理员 reject 掉其中 2 笔。
- 新用户重新进入并点击 claim → 应正常创建申请并占用刚才释放出来的两个额度之一，广告状态恢复可领取。

---

#### C-4: 退款计算使用 `quota_total - quota_used`，但 `quota_claimed` 可能大于 `quota_used`

**文件**: `tweetcat-x402-worker/tweetcattips/src/database_ad.ts:1285-1287`

```typescript
const remainingQuota = BigInt(ad.quota_total) - BigInt(ad.quota_used);
const refundAmount = remainingQuota * unitPrice;
```

**问题**: `quota_used` 只在 `settleAdReward` (CONFIRMED) 时递增。但被冻结的金额是按 `quota_total` 计算的，而 `quota_claimed` 中包含了 `PENDING_CONFIRM` 和 `REJECTED` 的 claim。退款计算应该排除**已确认**的部分，而不是**已使用**的部分。但如果有 pending claims 还在等待结算，这个退款就可能多退。

**影响**: 可能导致退款金额大于实际冻结金额，造成 `frozen_atomic` 变成负数。  
**建议**: `refundAdBudget` 中已有 `WHERE frozen_atomic >= refundAmount` 保护，但应确保 `hasPendingClaimsForAd` 检查在退款前总是正确执行。

---

### 🟡 中等缺陷 (Medium)

#### M-1: 蓝V白名单硬编码且前后端不一致

**文件**: 
- `src/popup/ads/ad_executor_plaza.ts:132-138` (前端白名单)
- `tweetcat-x402-worker/tweetcattips/src/api_srv_ads.ts:486-495` (后端白名单)

**问题**: 
1. 两个白名单内容不完全一致（后端多了 `1716169276855988224`, `1236539014406012928`）。
2. 硬编码的用户 ID 不应出现在生产代码中。

**建议**: 白名单应统一从配置/环境变量读取，或在正式发布前移除。

---

#### M-2: [✅ 已修复] `handleToggleAdStatus` 函数中错误地使用 `response.json()` 两次

**修复方案**: 已移除 `response.ok` 判断和 `.json()` 调用，直接接收 `x402WorkerFetch` 已经解析好的对象，并在发生网络或业务异常时触发 try-catch 获取 Error 对待。

**验证测试**: 
- 从 Dashboard 中点击 "暂停" 广告 → 操作顺畅没有报错提示，表格数据动态变更为 PAUSED_MANUAL。
- 将暂停的广告 "启用" → 界面弹出成功提示，列表更新为 ACTIVE。

---

#### M-3: `startTask` 函数已不再发送 claim 请求，但 UI 行为不明确

**文件**: `src/popup/ads/ad_executor_plaza.ts:116-185`

**问题**: `startTask` 函数只做蓝V检查和打开落地页，真正的 claim 流程在 content script 的 `_appendAdsFollowOfferBtn` 中完成。但在 explore tab 中点击卡片/按钮会调用 `startTask`，用户通过 popup 发起的 claim 流程实际上不会发送 claim 请求到服务器。

**影响**: 用户可能困惑为什么点击"Start Task"后没有收到奖励。  
**建议**: 明确 UI 流程：popup 中只负责引导用户到 KOL 主页，claim 只在 content script 中触发。按钮文案应改为"前往关注"而非"Start Task"。

---

#### M-4: `ad_publisher_balance.ts` 充值前未限制金额上限

**文件**: `src/popup/ads/ad_publisher_balance.ts:206-217`

```typescript
if (transferDirection === "ads_to_wallet") {
    const maxAds = atomicToUsdcNumber(publisherState.dashboardInfo.balance_atomic);
    if (amount > maxAds + 1e-9) throw new Error("Amount exceeds Ads Available.");
}
// ❌ wallet_to_ads 方向缺少余额检查
```

**问题**: `wallet_to_ads` 方向没有前端余额检查。虽然服务器端会通过 x402 支付流程做验证，但前端应做预校验。  
**建议**: 增加 `wallet_to_ads` 方向的钱包余额预校验。

---

#### M-5: Cron 结算任务中 proof 验证过于简单

**文件**: `tweetcat-x402-worker/tweetcattips/src/cron_ads_settle.ts:34-55`

**问题**: 
1. 只检查了 `following === true` 这一个布尔值，没有验证 proof_data 中的用户身份是否与 claim 中的 `b_x_id` 匹配。
2. 没有二次确认关注状态的能力（proof_data 是 claim 时的快照，用户可能在结算前取消关注）。
3. 未验证 proof_data 的时效性（用户是否在广告有效期内关注的）。

**建议**: 
- 在 proof 中增加被关注 KOL 的 screen_name 或 user_id，与广告的 detail_url 交叉验证。
- 考虑引入二次抽样验证机制。

---

#### M-6: `getPerformerDashboardStats` 中 `withdrawable_atomic` 包含了所有 CONFIRMED claims

**文件**: `tweetcat-x402-worker/tweetcattips/src/database_ad.ts:667`

**问题**: `withdrawable_atomic` 是所有 CONFIRMED 的 claim 的总和，没有减去已经提现过的金额。用户提现后，如果 claim 记录没被修改，`withdrawable_atomic` 仍然包含已提现部分。

**影响**: 用户看到的可提现金额可能大于实际可提现金额。  
**建议**: 应该从 `ad_escrow_accounts` 的 `available_atomic` 读取真实可提现余额。

---

### 🟢 轻微缺陷 (Low)

#### L-1: 前端 `myClaims` 在 explore tab 中用于过滤已 claim 的广告，但数据可能不完整

**文件**: `src/popup/ads/ad_executor_plaza.ts:390-392`

```typescript
let baseAds = executorState.earnAds.filter(ad =>
    !executorState.myClaims.some(c => c.ad_id === ad.id)
);
```

**问题**: `myClaims` 通过 `loadClaims()` 从 `/ads/executor/my_claims` 获取，但该 API 可能不返回分页数据，导致遗漏。

---

#### L-2: 多处 `showNotification` 使用中文和英文混杂

**文件**: 多个文件

**建议**: 统一国际化，使用 `t()` 函数。

---

#### L-3: `ad_executor_common.ts` 中 `taskRunState` 使用内存对象，页面刷新后丢失

**问题**: popup 关闭再打开时，所有 `taskRunState` 重置为空，不影响功能但可能导致重复点击。

---

#### L-4: `getPerformerTasksCount` 和 `getPerformerTasksWithAdInfo` 中的 SQL 注入风险

**文件**: `tweetcat-x402-worker/tweetcattips/src/database_ad.ts:718`

```typescript
statusFilter = `AND c.status IN (${statuses.map(s => `'${s}'`).join(",")})`;
```

**问题**: 虽然 `statusMap` 限制了可选值，但 SQL 字符串拼接不是最佳实践。  
**建议**: 使用参数化查询。

---

## 3. 测试计划总览

| 优先级 | 模块 | 用例数 | 预估工时 |
|--------|------|--------|----------|
| P0 | 广告主发布广告 | 12 | 2h |
| P0 | 资金管理（充值/提现） | 15 | 3h |
| P0 | 用户执行广告任务 | 18 | 4h |
| P0 | 任务结算 (Cron) | 10 | 2h |
| P0 | 安全性验证 | 12 | 3h |
| P1 | 广告生命周期管理 | 14 | 2h |
| P1 | Content Script 交互 | 12 | 3h |
| P1 | 用户领取/提现奖励 | 8 | 2h |
| P2 | Feed 同步与缓存 | 8 | 1.5h |
| P2 | SW 消息路由权限 | 8 | 1.5h |
| P2 | 边界条件 & 并发 | 15 | 3h |
| P3 | 回归 & 集成测试 | 10 | 2h |
| **合计** | | **~142** | **~29h** |

---

## 4. 模块一：广告主发布广告

### 涉及代码
| 层级 | 文件 |
|------|------|
| 前端 | `ad_publisher_ads.ts` → `submitPublishForm()` |
| 后端 | `api_srv_ads.ts` → `apiAdsCreate()` |
| 数据库 | `database_ad.ts` → `reserveAdBudget()`, `createAd()` |

### 测试用例

| # | 测试场景 | 预期结果 | 优先级 |
|---|---------|---------|--------|
| P-01 | 🤖 正常发布：填写所有必填字段，余额充足 | 广告创建成功，余额从 available 移至 frozen，feed version 递增 | P0 |
| P-02 | 👋 缺少广告名称 | 前端拦截："Please enter a campaign name." | P0 |
| P-03 | 👋 奖励金额为 0 或负数 | 前端拦截："Reward per follow must be greater than 0." | P0 |
| P-04 | 👋 奖励金额非数字（如 "abc"） | 前端拦截：parseFloat 返回 NaN → 提示错误 | P1 |
| P-05 | 👋 截止日期为过去时间 | 前端和后端均拦截："End date must be in the future." | P0 |
| P-06 | 👋 未选择截止日期 | 前端拦截 | P1 |
| P-07 | 🤖 余额不足 | 后端返回 `INSUFFICIENT_BALANCE`，前端显示具体差额 | P0 |
| P-08 | 👋 目标 URL 为空 | 前端拦截："Please enter a target Twitter profile URL." | P1 |
| P-09 | 🤖 极大配额（如 1,000,000）× 高单价（如 10 USDC） | 验证 BigInt 计算是否溢出，余额校验是否正确 | P1 |
| P-10 | 👋 发布后刷新页面查看广告列表 | 新广告应出现在 "My Ads" 表格中，状态为 ACTIVE | P0 |
| P-11 | 👋 连续快速点击提交按钮 | 按钮应在第一次点击后 disable，防止重复提交 | P1 |
| P-12 | 👋 发布完成后预算摘要更新 | dashboard 的 frozen、active campaigns 数量正确更新 | P1 |

---

## 5. 模块二：广告主资金管理（充值 / 提现）

### 涉及代码
| 层级 | 文件 |
|------|------|
| 前端 | `ad_publisher_balance.ts` |
| 后端 | `api_srv_ads.ts` → `apiRechargeToAdEscrowAccount()`, `apiWithdrawFromAdsEscrowAccount()` |
| 数据库 | `database_ad.ts` → `creditEscrowBalance()`, `debitEscrowBalance()`, `insertDepositLedger()`, `insertWithdrawLedger()` |

### 测试用例

| # | 测试场景 | 预期结果 | 优先级 |
|---|---------|---------|--------|
| B-01 | 🤖 **充值**：正常金额从钱包转入 Ads 账户 | x402 支付成功 → 账本记录(DEPOSIT/SETTLED) → available_atomic 增加 | P0 |
| B-02 | 🤖 充值金额超过钱包余额 | x402 支付失败，Ads 账户余额不变 | P0 |
| B-03 | 👋 充值金额为 0 | 前端拦截："Please enter a valid amount." | P1 |
| B-04 | 👋 充值金额为负数 | 前端拦截 | P1 |
| B-05 | 🤖 同一 txHash 的充值请求重复到达 | 幂等保护：`ON CONFLICT(tx_hash) DO NOTHING`，余额只增加一次 | P0 |
| B-06 | 🤖 **提现**：正常金额从 Ads 账户提现到绑定钱包 | 扣减 available → 链上转账 → 账本 SETTLED → txHash 返回 | P0 |
| B-07 | 🤖 提现金额超过可用余额 | 返回 `INSUFFICIENT_BALANCE` | P0 |
| B-08 | 🤖 **月度提现限制**：本月已提现一次，再次提现 | 返回 `alreadyWithdrawn: true`，显示上次 txHash 和下次可用日期 | P0 |
| B-09 | 🤖 上月提现过，本月首次提现 | 正常执行（幂等 key 变了：`{xId}_{YYYYMM}`） | P0 |
| B-10 | 🤖 提现过程中链上转账失败 | 账本标记 FAILED，余额退回 (refundEscrowBalance) | P0 |
| B-11 | 🤖 提现请求 PENDING 状态中，再次发起提现 | 返回 `PENDING` 错误 | P1 |
| B-12 | 👋 前端 "Max" 按钮 | 正确填入当前方向的最大可用金额 | P1 |
| B-13 | 👋 切换方向后校验状态更新 | 月度限制警告只在 `ads_to_wallet` 方向显示 | P1 |
| B-14 | 🤖 未绑定钱包地址的用户尝试提现 | 后端返回 "User wallet address not found" | P1 |
| B-15 | 🤖 并发充值请求（同一用户同时发起两笔） | 两笔均应正确处理（不同 txHash），余额累加 | P2 |

---

## 6. 模块三：广告生命周期管理（暂停 / 启用 / 结束 / 充值预算）

### 涉及代码
| 层级 | 文件 |
|------|------|
| 前端 | `ad_publisher_dashboard.ts` → `handleToggleAdStatus()`, `handleTopUpAdBudget()` |
| 后端 | `api_srv_ads.ts` → `apiAdsToggleStatus()`, `apiAdsTopUpBudget()` |
| Cron | `cron_ads_expire.ts`, `cron_ads_refund.ts` |

### 测试用例

| # | 测试场景 | 预期结果 | 优先级 |
|---|---------|---------|--------|
| LC-01 | 🤖 ACTIVE → 暂停 (pause) | 状态变为 `PAUSED_MANUAL`，广告从广场消失，feed version 递增 | P0 |
| LC-02 | 🤖 PAUSED_MANUAL → 启用 (resume) | 状态变为 `ACTIVE`，广告重新出现在广场 | P0 |
| LC-03 | 🤖 对非 ACTIVE 广告执行 pause | 返回 `INVALID_STATE` | P1 |
| LC-04 | 🤖 对非 PAUSED_MANUAL 广告执行 resume | 返回 `INVALID_STATE` | P1 |
| LC-05 | 🤖 ACTIVE → 结束 (stop) | 状态变为 `COMPLETED`，按钮变为 N/A | P0 |
| LC-06 | 🤖 PAUSED_MANUAL → 结束 (stop) | 状态变为 `COMPLETED` | P1 |
| LC-07 | 🤖 EXPIRED/COMPLETED → 任何操作 | 返回 `INVALID_STATE` | P0 |
| LC-08 | 🤖 **追加预算**：ACTIVE 广告充值 5 USDC (单价 0.1) | quota_total += 50, available -= 5, frozen += 5 | P0 |
| LC-09 | 🤖 追加预算金额不够一个任务 | 返回 `INVALID_AMOUNT` | P1 |
| LC-10 | 🤖 PAUSED_NO_BUDGET → 充值 | 追加配额后状态自动变为 ACTIVE | P0 |
| LC-11 | 🤖 充值余额不足 | 返回 `INSUFFICIENT_BALANCE` | P0 |
| LC-12 | 🤖 **Cron 过期扫描**：广告 end_date 已过 | 状态自动变为 EXPIRED | P0 |
| LC-13 | 🤖 **Cron 满额扫描**：quota_claimed >= quota_total | 状态自动变为 COMPLETED | P0 |
| LC-14 | 🤖 **Cron 退款**：EXPIRED 广告无 pending claims | frozen 退回 available，budget_settlement_status = SETTLED | P0 |

---

## 7. 模块四：用户执行广告（关注任务流程）

### 涉及代码
| 层级 | 文件 |
|------|------|
| Content | `twitter_ui.ts` → `_appendAdsFollowOfferBtn()` |
| SW | `bg_msg.ts`, `bg_ads_verifier.ts` → `verifyFollowAndClaim()` |
| SW | `bg_ads_follow.ts` → `claimAdsFollowOffer()` |
| 后端 | `api_srv_ads.ts` → `apiAdsClaim()` |

### 测试用例

| # | 测试场景 | 预期结果 | 优先级 |
|---|---------|---------|--------|
| EX-01 | 👋 用户访问有广告的 KOL 主页 | 显示「关注即领 X USDC」按钮 | P0 |
| EX-02 | 👋 用户已关注该 KOL | 不显示按钮或按钮状态为「已关注」 | P0 |
| EX-03 | 👋 用户是该 KOL 本人 | 不显示按钮（self-follow 防护） | P1 |
| EX-04 | 👋 用户未登录钱包 | 点击按钮 → 提示登录钱包 | P0 |
| EX-05 | 🤖 正常关注流程：点击按钮 → 触发原生关注 → 拦截确认 → 提交证据 | Claim 创建成功，状态 PENDING_CONFIRM | P0 |
| EX-06 | 👋 关注确认超时（15秒） | 提示"关注确认超时或失败"，状态回到 Eligible | P0 |
| EX-07 | 🤖 关注成功但 ProfileSpotlights 返回未关注 | 后端拒绝或结算时被 reject | P0 |
| EX-08 | 🤖 重复 claim 同一广告 | 服务器返回 `already_claimed: true` | P0 |
| EX-09 | 🤖 广告配额已满 | 服务器返回 `QUOTA_FULL`，前端按钮显示 "Completed" | P0 |
| EX-10 | 🤖 广告已过期 | 服务器返回 `AD_EXPIRED` | P0 |
| EX-11 | 🤖 广告已暂停 | 服务器返回 `AD_NOT_ACTIVE` | P0 |
| EX-12 | 🤖 白名单用户跳过蓝V检查 | 允许 claim 但应记录日志 | P1 |
| EX-13 | 🤖 蓝V证据签名无效 | 服务器返回 `INVALID_BLUE_V_PROOF` | P0 |
| EX-14 | 🤖 蓝V证据中的 userId 与 b_x_id 不匹配 | 服务器返回 `USER_MISMATCH` | P0 |
| EX-15 | 🤖 蓝V状态为 false（非蓝V用户） | 服务器返回 `NOT_BLUE_VERIFIED` 或前端拦截 | P0 |
| EX-16 | 👋 蓝V状态过期（超过 7 天） | 前端引导用户刷新状态 | P1 |
| EX-17 | 🤖 claim 创建失败后的回滚 | quota_claimed 应该 -1（best effort），claim state 被 clear | P0 |
| EX-18 | 👋 多个广告指向同一 KOL | Feed 选最高 reward 的 offer 展示 | P2 |

---

## 8. 模块五：任务结算与奖励（Cron 定时任务）

### 涉及代码
| 文件 | 职责 |
|------|------|
| `cron_ads_settle.ts` | 扫描 >24h 的 PENDING_CONFIRM claims，验证 proof 后结算 |
| `cron_ads_expire.ts` | 将过期/满额广告状态更新为 EXPIRED/COMPLETED |
| `cron_ads_refund.ts` | 将已结束广告的剩余冻结预算退回给广告主 |
| `database_ad.ts` | `settleAdReward()`, `rejectAdReward()`, `refundAdBudget()` |

### 测试用例

| # | 测试场景 | 预期结果 | 优先级 |
|---|---------|---------|--------|
| CR-01 | 🤖 PENDING_CONFIRM 超过 24h，proof 中 following=true | Claim 状态 → CONFIRMED，广告主 frozen 扣减，执行者 available 增加，quota_used +1 | P0 |
| CR-02 | 🤖 PENDING_CONFIRM 超过 24h，proof 中 following=false | Claim 状态 → REJECTED，`quota_claimed` 配额退回广告可用池，quota_used 不变（✅ **已修复 C-3**）| P0 |
| CR-03 | 🤖 PENDING_CONFIRM 超过 24h，proof_data 为空 | Claim 状态 → REJECTED（Missing proof data） | P0 |
| CR-04 | 🤖 PENDING_CONFIRM 超过 24h，proof_type 未知 | Claim 状态 → REJECTED | P1 |
| CR-05 | 🤖 PENDING_CONFIRM 超过 24h，proof_data JSON 格式错误 | Claim 状态 → REJECTED（Malformed proof JSON） | P1 |
| CR-06 | 🤖 广告主冻结余额不足（异常情况） | settleAdReward 返回 false，claim 保留 PENDING 状态 | P0 |
| CR-07 | 🤖 批量结算：50 条 claims 同时处理 | 每条独立处理，一条失败不影响其他 | P1 |
| CR-08 | 🤖 **退款流程**：EXPIRED 广告，quota_total=100, quota_used=30 | 退回 70 * unit_price 到 available，budget_settlement_status=SETTLED | P0 |
| CR-09 | 🤖 退款流程：有 PENDING_CONFIRM claims | 跳过退款，等待 claims 结算完成 | P0 |
| CR-10 | 🤖 退款流程：冻结余额不足以退回计算金额 | 退款失败，不更新 budget_settlement_status | P1 |

---

## 9. 模块六：用户领取 / 提现奖励

### 涉及代码
| 层级 | 文件 |
|------|------|
| 前端 | `ad_executor_summary.ts` → `initSummaryActions()` |
| 后端 | `api_srv_ads.ts` → `apiWithdrawFromAdsEscrowAccount()` |

### 测试用例

| # | 测试场景 | 预期结果 | 优先级 |
|---|---------|---------|--------|
| EW-01 | 🤖 可提现金额 > 0，点击提现 | 链上转账成功，withdrawableUSDC 归零，txHash 显示 | P0 |
| EW-02 | 👋 可提现金额 = 0 | 提示 "Nothing to withdraw." | P0 |
| EW-03 | 👋 提现金额不一致（前端计算 vs 服务器余额） | 以服务器实际 available_atomic 为准 | P0 |
| EW-04 | 🤖 提现过程中链上转账失败 | 余额退回，提示错误信息 | P0 |
| EW-05 | 🤖 月度提现限制（如果适用于 Executor） | 同模块二 B-08 | P1 |
| EW-06 | 👋 提现后 2 秒自动刷新 summary | withdrawableUSDC 已更新，totalEarnedUSDC 不变 | P1 |
| EW-07 | 👋 查看 Activity 列表 | 显示所有 claim 记录，时间和状态正确 | P2 |
| EW-08 | 👋 Activity Modal 打开/关闭 | 正常切换，点击遮罩关闭 | P2 |

---

## 10. 模块七：安全性与签名验证

### 涉及代码
| 层级 | 文件 |
|------|------|
| 客户端 | `common/device_key.ts` → `signDeviceData()`, `ensureDeviceKey()` |
| 客户端 | `object/blue_v.ts` → `saveCurrentUserBlueVStatus()` |
| 服务器 | `api_srv_ads.ts` → `verifyBlueVProof()` |

### 测试用例

| # | 测试场景 | 预期结果 | 优先级 |
|---|---------|---------|--------|
| S-01 | 🤖 正常签名：设备私钥对 blueV 数据签名 → 服务器验证 | 验证通过 ✅ | P0 |
| S-02 | 🤖 篡改 isBlueVerified (false → true)：签名不变 | 服务器验证失败：签名与数据不匹配 | P0 |
| S-03 | 🤖 篡改 userId：签名不变 | 服务器验证失败 | P0 |
| S-04 | 🤖 使用不同设备的私钥签名 | 服务器使用 proof 中的 pubKey 验证会失败（需要设备绑定机制才有效） | P0 |
| S-05 | 🤖 缺少签名字段 | `verifyBlueVProof` 返回 false | P1 |
| S-06 | 🤖 缺少 devicePubKey 字段 | `verifyBlueVProof` 返回 false | P1 |
| S-07 | 🤖 Base64 vs Base64URL 编码混合 | `decodeB64OrB64UrlToArrayBuffer` 应正确处理两种格式 | P1 |
| S-08 | 👋 设备 Key 首次生成 | `ensureDeviceKey()` 自动生成并存储到 IndexedDB | P1 |
| S-09 | 👋 设备 Key 已存在 | `ensureDeviceKey()` 直接返回缓存 | P2 |
| S-10 | 🤖 **⚠️ 安全缺陷验证**：任意公钥自签名 | 使用伪造公钥签名的 evidence 请求 API，服务端使用绑定的可信公钥验签将拒绝此证明（✅ **已修复 SEC-01**）。 | P0 |
| S-11 | 👋 CSRF Token 同步 | `syncTwitterCredentials()` 正确获取 ct0 cookie | P1 |
| S-12 | 👋 ProfileSpotlights API 返回空数据 | `verifyFollowAndClaim` 抛出错误 | P1 |

---

## 11. 模块八：Content Script 按钮与 UI 交互

### 涉及代码
| 文件 | 职责 |
|------|------|
| `content/twitter_ui.ts` | 在 KOL 主页注入「关注即领」按钮 |
| `content/main_entrance.ts` | 消息分发、蓝V 验证模式 |
| `content/common.ts` | Toast、Dialog、Loading 等 UI 组件 |

### 测试用例

| # | 测试场景 | 预期结果 | 优先级 |
|---|---------|---------|--------|
| UI-01 | 👋 首次加载 KOL 主页（有广告投放） | 按钮正确注入到 profile toolbar | P0 |
| UI-02 | 👋 从 KOL 主页导航到其他用户主页 | 旧按钮移除，新按钮正确注入 | P1 |
| UI-03 | 👋 页面滚动加载后按钮位置 | 按钮不因 re-render 重复添加 | P1 |
| UI-04 | 👋 按钮 UI 状态流转 | Loading → Eligible / AlreadyFollowing → Processing → Claimed | P0 |
| UI-05 | 👋 暗色模式 / Dim 模式兼容 | 按钮样式自适应 Twitter 主题 | P2 |
| UI-06 | 👋 `tc_verify=1` 验证模式 | 页面加载后触发蓝V验证弹窗 | P1 |
| UI-07 | 👋 验证模式：用户是蓝V | 弹窗 "✅ Verification Success!" | P1 |
| UI-08 | 👋 验证模式：用户不是蓝V | 弹窗 "❌ Verification Failed" | P1 |
| UI-09 | 👋 原生关注按钮不存在（用户已关注/页面未完全加载） | 提示 "未找到关注按钮" | P1 |
| UI-10 | 👋 侧边栏推荐用户 vs 主页面用户区分 | 按钮只注入到 primaryColumn 的按钮 | P2 |
| UI-11 | 👋 IJFollowActionCaptured 拦截 | 正确更新缓存的 following 状态 | P1 |
| UI-12 | 👋 offscreen wallet 查询超时 | 合理的超时处理和错误提示 | P2 |

---

## 12. 模块九：Service Worker (Background) 消息路由与权限控制

### 涉及代码
| 文件 | 职责 |
|------|------|
| `service_work/bg_msg.ts` | 消息路由、来源校验、权限分层 |

### 测试用例

| # | 测试场景 | 预期结果 | 优先级 |
|---|---------|---------|--------|
| SW-01 | 👋 来自扩展内部页面的 AdsFollowVerifyAndClaim | 正常处理 | P0 |
| SW-02 | 👋 来自 x.com 页面 top frame 的 AdsFollowVerifyAndClaim | 正常处理（在 X_PAGE_ALLOWED_ACTIONS 中） | P0 |
| SW-03 | 👋 来自非 x.com 页面的 AdsFollowVerifyAndClaim | 校验失败："not x.com/twitter.com tab" | P0 |
| SW-04 | 👋 来自 iframe 的高风险操作 | 校验失败："not top frame" | P0 |
| SW-05 | 👋 来自外部网页的 WalletTransferUSDC | 拒绝："This action must be performed in the extension popup." | P0 |
| SW-06 | 🤖 AdsFollowOfferQuery 返回正确的 offer 和 claim_state | offer 含 ad_id, reward_usdc; claim_state 含当前状态 | P1 |
| SW-07 | 🤖 AdsFollowClaim 成功后 poll feed 更新 | `pollAdsFeedIfNeeded(true)` 被调用 | P2 |
| SW-08 | 👋 IJUserByScreenNameCaptured 转发到 background | 蓝V状态被保存到 IndexedDB | P1 |

---

## 13. 模块十：广告 Feed 同步与缓存

### 涉及代码
| 文件 | 职责 |
|------|------|
| `service_work/bg_ads_feed.ts` | 版本化 feed 同步、本地缓存管理 |
| 后端 | `database_ad.ts` → feed meta, getActiveAdsList |

### 测试用例

| # | 测试场景 | 预期结果 | 优先级 |
|---|---------|---------|--------|
| FD-01 | 🤖 首次 poll：无本地缓存 | 获取 version → 获取 list → 建立本地缓存 | P0 |
| FD-02 | 🤖 二次 poll：version 未变 | 跳过 list 获取 | P1 |
| FD-03 | 🤖 version 变化后 poll | 重新获取 list 并更新缓存 | P0 |
| FD-04 | 🤖 `next_invalidation_at` 到达 | 即使 version 不变也重新拉取 list | P1 |
| FD-05 | 🤖 并发 poll（SW wakeup bursts） | `pollInFlight` 锁保护，只执行一次 | P1 |
| FD-06 | 🤖 `normalizeProfileUrl` 归一化 | `https://x.com/User` → `https://x.com/user`, 忽略 query/hash | P2 |
| FD-07 | 🤖 多个 offer 指向同一 URL | `pickBetterOffer` 选 reward 最高的 | P2 |
| FD-08 | 👋 IndexedDB 持久化失败 | 降级使用 localStorage 缓存，不抛错 | P2 |

---

## 14. 模块十一：边界条件与并发场景

### 测试用例

| # | 测试场景 | 预期结果 | 优先级 |
|---|---------|---------|--------|
| E-01 | 🤖 **竞态条件**：两个用户同时 claim 最后一个配额 | 只有一个成功（`incrementAdClaimedQuota` 的 WHERE 条件保护） | P0 |
| E-02 | 🤖 **竞态条件**：用户同时在 popup 和 content 发起 claim | `getDetailedClaim` 幂等检查防止重复 | P0 |
| E-03 | 🤖 广告主在用户 claim 过程中暂停广告 | `incrementAdClaimedQuota` 的 `WHERE status = 'ACTIVE'` 保护 | P0 |
| E-04 | 🤖 广告在 claim 提交瞬间过期 | `WHERE end_date > datetime('now')` 保护 | P0 |
| E-05 | 🤖 大量 claims（1000+）同时处于 PENDING_CONFIRM | Cron 每次只处理 50 条，不超时 | P1 |
| E-06 | 🤖 同一广告被 EXPIRED 和 COMPLETED 同时触发 | SQL UPDATE 的 WHERE 条件确保只更新一次 | P2 |
| E-07 | 🤖 极小金额（1 atomic unit = 0.000001 USDC） | 全链路支持 | P2 |
| E-08 | 🤖 BigInt 边界：`unit_price_atomic` 极大值 | `CAST ... AS INTEGER` 在 SQLite 中的行为验证 | P2 |
| E-09 | 👋 网络断开后重连 | 前端正确恢复状态（loading/error/retry） | P2 |
| E-10 | 👋 Extension 升级期间的 SW 重启 | claim state 持久化到 IndexedDB，升级后可恢复 | P2 |
| E-11 | 🤖 广告主自己 claim 自己的广告 | 应返回 403 HTTP 错误及 SELF_CLAIM_FORBIDDEN（✅ **已修复 SEC-03**） | P0 |
| E-12 | 🤖 同一用户对同一广告重复提交不同证据 | 第二次应返回 already_claimed | P1 |
| E-13 | 🤖 `unit_price_atomic` 为 0 的广告 | `apiAdsCreate` 的 `parsePositiveAtomic` 应拦截 | P1 |
| E-14 | 🤖 广告主在广告有 pending claims 时尝试 stop | Cron 会等待 pending claims 结算完再退款 | P1 |
| E-15 | 🤖 提现 FAILED 后再次尝试提现（同月） | 已有 FAILED 记录，当前逻辑会返回错误。应允许 retry。 | P1 |

---

## 15. 模块十二：回归与集成测试

### 端到端流程测试

| # | 测试场景 | 步骤 | 预期结果 | 优先级 |
|---|---------|------|---------|--------|
| E2E-01 | 👋 完整的广告生命周期 | 充值 → 发布 → 用户关注 → 等待结算 → 结算完成 → 广告过期 → 退款 | 各阶段余额变化正确 | P0 |
| E2E-02 | 🤖 广告满额关闭 | 发布(quota=3) → 3人 claim → 全部结算 → 自动 COMPLETED → 退款(0) | 无退款，冻结余额清零 | P0 |
| E2E-03 | 🤖 广告中途 stop + 退款 | 发布(quota=10) → 3人 claim → stop → 等待 3 人结算 → 退款(7*price) | 广告主余额正确增加 | P0 |
| E2E-04 | 👋 用户取消关注后重新关注 | claim1 结算 → 用户 unfollow → 再次 follow → 尝试 claim2 | 返回 already_claimed | P1 |
| E2E-05 | 👋 多广告主同一 KOL | A 发布 follow @X (0.1U), B 发布 follow @X (0.5U) | 用户看到 0.5U 的 offer（pickBetterOffer） | P1 |
| E2E-06 | 🤖 用户同时是广告主和执行者 | 充值 → 发布自己的广告 → 尝试 claim 自己的广告 | 应被拒绝（缺陷 E-11 覆盖） | P0 |
| E2E-07 | 🤖 Cron 任务并发执行 | expire + settle + refund 同时运行 | 无死锁，数据一致 | P2 |
| E2E-08 | 🤖 大规模数据 | 1000 广告 + 10000 claims | API 响应时间 < 3s，分页正确 | P2 |
| E2E-09 | 👋 广告主提现 → 查看历史 | 历史记录中有 txHash 可点击查看区块浏览器 | P1 |
| E2E-10 | 🤖 全流程账本审计 | 对比 available + frozen 与 所有 ledger 记录的 sum | 恒等式成立 | P0 |

---

## 附录 A：已确认的安全风险清单

| ID | 风险 | 严重程度 | 当前状态 |
|----|------|----------|----------|
| SEC-01 | 蓝V 证据使用自带公钥验证，攻击者可伪造 | 🔴 严重 | ✅ **已修复**: API 强制读取数据库中通过钱包鉴权绑定的 `device_pubkey_spki` |
| SEC-02 | 白名单用户 ID 硬编码在源码中 | 🟡 中等 | 应移至环境变量或配置 |
| SEC-03 | 广告主可以 claim 自己的广告（缺少 a_x_id ≠ b_x_id 校验） | 🔴 严重 | ✅ **已修复**: `apiAdsClaim` 已加入 `a_x_id === bXId` 服务端拦截并返回 Http 403 |
| SEC-04 | Cron 结算时不验证蓝V签名，只检查 proof_data | 🟡 中等 | Claim 阶段已验证，结算时可信任 |
| SEC-05 | 关注证据是一次性快照，用户可在结算前取消关注 | 🟡 中等 | 设计决策：接受 24h 内取关风险 |
| SEC-06 | SQL 字符串拼接（非参数化查询） | 🟢 轻微 | 输入已受限，但应改进 |

---

## 附录 B：资金流恒等验证公式

对于任一广告主账户，以下恒等式应始终成立：

```
available_atomic + frozen_atomic 
= SUM(DEPOSIT.amount) 
- SUM(WITHDRAW.amount[settled]) 
- SUM(CONFIRMED_claims.unit_price_atomic)  # 已从 frozen 转给执行者
```

对于任一执行者账户：

```
available_atomic 
= SUM(CONFIRMED_claims.unit_price_atomic) 
- SUM(WITHDRAW.amount[settled])
```

对于任一广告：

```
frozen_for_ad = (quota_total - quota_used) * unit_price_atomic  # 广告存续期间
frozen_for_ad = 0  # 广告已 SETTLED (退款完成后)
```

---

## 附录 C：测试环境搭建建议

### 单元测试
- 使用 **Vitest** 或 **Jest** 针对纯函数进行测试（如 `getRewardRange`, `formatClaimTime`, `getEffectiveStatus`, `computePopularityScore` 等）
- Mock `x402WorkerFetch`, `x402WorkerGet` 等网络请求函数

### 集成测试
- 使用 **Miniflare** 模拟 Cloudflare Workers 环境，测试 `api_srv_ads.ts` 中的所有 API
- 使用 SQLite in-memory 数据库模拟 D1

### E2E 测试
- 使用 **Playwright** + Chrome Extension 模式
- 需要准备测试用的 Twitter 账户（或 Mock Twitter API）
- 需要测试网（Base Sepolia）的 USDC

### 手动测试检查单
- [ ] 发布广告后 dashboard 数据正确
- [ ] 充值后余额立即更新
- [ ] 关注后按钮状态正确流转
- [ ] Cron 结算后用户可提现
- [ ] 广告过期后预算正确退回
- [ ] 提现交易在区块浏览器可查
