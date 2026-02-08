# TweetCat Ads — Follow-to-Earn（关注即领 X USDC）v1

Last updated: 2026-02-05

本文档是 **Follow 激励广告 v1** 的“唯一工作说明 + AI 交接 Runbook”。目标是让任何 AI/开发者在不阅读聊天记录的情况下，也能从本文档理解上下文、掌握当前实现进度，并按步骤继续把 v1 做成可上线的闭环。

---

## 0. 范围与最终目标（Definition of Done）

### 0.1 角色

- **广告主（Publisher / Advertiser）**：充值到平台托管广告账户（ad escrow），创建广告任务并锁定预算。
- **执行者（Executor）**：在 X（x.com）上完成任务动作（关注等），提交 proof/evidence，等待确认后收款。
- **平台（TweetCat Worker + Extension）**：管理预算冻结/消耗/退款、任务状态、证据与结算。

### 0.2 v1 只聚焦的广告类型

- `follow`（关注激励）

代码中还存在占位类型（未来扩展）：
- `visit` / `register` / `share`

### 0.3 v1 的最终目标（闭环）

当 v1 完成后，应满足：

1) 广告主能创建 follow 广告并锁预算；可暂停/恢复；可追加 quota（不改价）；到期自动结束（ended）。
2) 执行者在广告主 **Profile 首页** 能稳定看到「关注即领 X USDC」按钮（由本地缓存决定显示，不泄露浏览轨迹）。
3) 执行者完成 follow 后提交 proof/evidence（扩展侧采集 + Device Key 签名 + 防重放），服务器入库并推进 claim 状态。
4) 服务器确认后：真实消耗冻结预算（frozen 扣减）、记账（spend ledger）、执行者结算（链上或平台内余额）、可选回调广告主 callback_url。
5) 广告结束后：剩余冻结预算按规则退回（refund），并能区分“无需退 / 待退 / 已退 / 失败重试”等状态。

---

## 1. 代码与文件地图（你应该从哪里读）

### 1.1 前端（扩展 UI）

- 广告主管理页：
  - `dist/html/ad_advertise.html`
  - `dist/css/ad_advertise.css`
  - `src/popup/ads/*`
- 广告广场（执行者在 popup 中领取）：
  - `src/popup/ads/ad_plaza.ts`

### 1.2 扩展 Content Script（X 页面注入）

- Profile 页按钮注入（本期新增/改造核心）：
  - `src/content/twitter_ui.ts`
  - `src/content/main_entrance.ts`
- 路由注入与 GraphQL 捕获（用于拿到 following 等字段）：
  - `src/inject_router.ts`
  - `src/inject_tweet_fetch.ts`

### 1.3 扩展 Service Worker（后台）

- 广告广场 feed 轮询/缓存/落库（本期新增核心）：
  - `src/service_work/bg_ads_feed.ts`
  - `src/service_work/bg_timer.ts`
  - `src/service_work/bg_msg.ts`
  - `src/service_work/background.ts`
- Profile follow 广告 claim（本期新增核心）：
  - `src/service_work/bg_ads_follow.ts`

### 1.4 扩展本地数据库（IndexedDB）

- 通用 IndexedDB 封装：
  - `src/common/database.ts`

### 1.5 服务器（Cloudflare Worker）

- 入口与 scheduled 示例：
  - `tweetcat-x402-worker/tweetcattips/src/index-dev.ts`
- Ads API：
  - `tweetcat-x402-worker/tweetcattips/src/api_srv_ads.ts`
- Ads DB access：
  - `tweetcat-x402-worker/tweetcattips/src/database_ad.ts`
- D1 Schema：
  - `tweetcat-x402-worker/tweetcattips/migrate.sql`
  - 临时 SQL（你手工执行的 patch 文件）：`tweetcat-x402-worker/tweetcattips/a.sql`

---

## 2. 核心概念（务必统一口径）

### 2.1 预算与资金（必须与状态机解耦）

广告主资金在平台托管账户中分为：

- `available_atomic`：可用余额（可提现/可锁预算）
- `frozen_atomic`：已锁预算（投放中“预留”）；**只有“结算确认”才会真实消耗扣减**；结束后可退款回 available

### 2.2 Claim / Settled / Spent（最关键口径）

Follow v1 必须坚持三件事：

- **Claim（领取占位）**：占用投放配额，但不等于完成、也不等于发放、也不等于真实消耗。
- **Settled（已结算/已确认发放）**：服务器确认任务真实，产生“真实消耗/发放”。
- **Spent（已花费）**：从广告主冻结预算中扣减的金额（通常等于 Settled * 单价），用于广告主报表。

当前实现已经把“Claim != Settled/Spent”拆开（见 4.1）。

---

## 3. 广告状态与按钮（稳定锚点）

### 3.1 广告主维度：Campaign Status（ended 优先）

广告状态枚举（前端类型见 `src/popup/ads/ad_publisher_common.ts`）：

- `ACTIVE`
- `PAUSED_NO_BUDGET`
- `PAUSED_MANUAL`
- `EXPIRED`（ended）
- `COMPLETED`（ended）

稳定规则（已落地）：

1) ended 优先：`EXPIRED/COMPLETED` 的显示优先级高于手动暂停。
2) ended 不允许 resume/pause。
3) ended 不允许更新 `callback_url/custom_data`（广告做审计只读）。

对应落地位置（已实现）：
- 后端有效状态优先级：`tweetcat-x402-worker/tweetcattips/src/database_ad.ts`
- 后端 update 拒绝 ended：`tweetcat-x402-worker/tweetcattips/src/api_srv_ads.ts`
- 前端 dashboard 禁用 ended 更新：`src/popup/ads/ad_publisher_dashboard.ts`

### 3.2 执行者维度：Profile 按钮 UI 状态（只缓存“已领取/处理中”）

按钮 UI mode（已抽常量到 `src/content/common.ts`）：

- `NoOffer`：无广告 -> 不显示按钮
- `Loading`：等待 inject 拿到 following -> 按钮 disabled 显示“加载中…”
- `AlreadyFollowing`：已关注 -> disabled 显示“已关注”
- `Eligible`：未关注且有 offer -> 可点击 “关注即领 X USDC”
- `Processing`：点击后 claim 进行中 -> disabled “处理中…”
- `ClaimedPendingProof`：claim 成功（占位） -> disabled “已领取，待验证”

本地缓存策略（已实现）：

- 不缓存派生状态（Eligible/AlreadyFollowing/Loading），它们由 “offer cache + inject following” 实时决定
- 只缓存与体验强相关的临时锚点：`Processing / ClaimedPendingProof`
  - 存储在 IndexedDB：`__table_ads_follow_claim_state__`（key = `ad_id`，TTL=24h）

---

## 4. 已完成的工作（截至 2026-02-05）

### 4.1 服务器（Worker / D1）

- ✅ 引入 `quota_claimed`：把“领取占位”与“已结算消耗”拆开
  - `ad_campaigns.quota_claimed`（占位）
  - `ad_campaigns.quota_used`（未来用于 settled/confirmed）
- ✅ `/ads/executor/claim`：只创建 claim + 增加 `quota_claimed`，不再增加 `quota_used`
- ✅ `COMPLETED` 计算口径调整：使用 `max(quota_claimed, quota_used) >= quota_total`
- ✅ 广告广场 feed 元信息：`ads_feed_meta`（单行 id=1）
- ✅ 新增 `GET /ads/executor/version`：返回 `version + next_invalidation_at`
  - `next_invalidation_at` = 当前可展示广告中最早的 `end_date`（用于“纯时间变化”驱动刷新）
- ✅ 对会影响 list 的写操作 bump version：
  - create / claim / toggle status / top-up budget 等

### 4.2 扩展 Service Worker（后台缓存与日志）

- ✅ 每分钟轮询 `GET /ads/executor/version`，根据以下条件刷新 list：
  - `versionChanged` 或
  - `now >= next_invalidation_at`（服务端）或 `now >= cached_next_invalidation_at`（本地）或
  - 手动 `forceListFetch`
- ✅ 拉取 `GET /ads/executor/list` 后构建 follow offer cache：
  - key = `normalizeProfileUrl(detailUrl)` -> `https://x.com/<username>`
  - 同一 profile 多 offer：挑 reward 更高/更晚创建等（见 `pickBetterOffer`）
- ✅ 缓存落地两份：
  - `browser.storage.local`（快速读）
  - IndexedDB：`__table_ads_follow_offers__` + `__table_ads_feed_meta__`
- ✅ 增加可观察日志（Dev 环境开关）：
  - `DBG.AdsFeed = true`（`src/common/debug_flags.ts`）
  - 你已经在 SW 控制台看到了 `[AdsFeed] ...` 日志

### 4.3 扩展 Content Script（Profile 按钮）

- ✅ 只在 **Profile 首页**（`/username`）插入按钮，避免在 `/media` 等子页乱插
- ✅ 从 SW 读取 `{offer, claim_state}` 决定是否显示按钮
- ✅ 利用 inject 捕获的 `UserByScreenName` GraphQL 响应读取 `legacy.following`，实时更新按钮状态
- ✅ 点击按钮走 `AdsFollowClaim`：
  - SW 侧先写入 claim_state=processing（本地锚点），再调用 `/ads/executor/claim`
  - 成功后 claim_state=claimed_pending_proof（待后续 submit_proof/confirm 流程）
  - 失败则回滚删除本地 claim_state

### 4.4 广告主管理 UI（口径与展示）

- ✅ My Ads 表新增 `Settled` 列（与 `Claimed/Spent` 区分）
- ✅ ended 广告不可更新 `callback/custom_data`

---

## 5. 你现在可以测试什么（当前可测范围）

### 5.1 必备条件

- 广告主账号能创建 follow 广告，且 `detail_url` 是广告主 Profile 首页：`https://x.com/<advertiser_username>`
- 执行者账号需要：
  - 扩展已登录（CDP）且绑定 X
  - 有 EOA 钱包（否则 `/ads/executor/claim` 会报错）

### 5.2 测试步骤（推荐最小流程）

1) 广告主发布 follow 广告（确保落地页是自己 profile 首页）
2) 等待 0~60s（或重载扩展）观察 Service Worker 日志：
   - `[AdsFeed] version fetched`：`version` 增长
   - `[AdsFeed] persisted follow offers ... count >= 1`
3) 在 DevTools → Application → IndexedDB → `tweet-cat-database` 确认：
   - `__table_ads_follow_offers__` 出现 `profileUrl=https://x.com/<advertiser_username>`
4) 用执行者账号打开该 profile 首页：
   - 按钮先显示“加载中…”（等待 inject 捕获 following）
   - inject 到位后：
     - 若未关注：变为“关注即领 X USDC”（可点击）
     - 若已关注：变为“已关注”（不可点）
5) 点击按钮（未关注时）：
   - 期望按钮变为“处理中…” -> “已领取，待验证”
   - IndexedDB → `__table_ads_follow_claim_state__` 出现 `ad_id` 对应记录
   - 服务端 D1：`ad_campaigns.quota_claimed` 增加；`quota_used` 不变（因为还没做 proof/confirm）

### 5.3 常见失败定位

- 按钮不出现：
  - 先看 `__table_ads_follow_offers__` 是否有对应 `profileUrl`
  - 检查广告的 `detail_url` 是否是纯 profile URL（否则 normalize 会过滤）
  - 只在 `/username` 首页插入，`/username/media` 不会显示
- 一直“加载中…”：
  - 说明 inject 没捕获到 `UserByScreenName`（检查 `src/inject_tweet_fetch.ts` 是否生效）
- 点击 claim 报错 “Please sign in first / X account not connected / Wallet not found”：
  - 执行者需要完成 CDP 登录 + 绑定 X + 创建钱包

---

## 6. 当前仍未实现（阻断完整闭环的缺口）

### 6.1 proof / submit_proof（执行者提交证据）缺失

现状：claim 只能停留在 `CLAIMED`（或本地 claimed_pending_proof），没有证据表、没有 proof API、没有状态推进到 `PENDING_CONFIRM/CONFIRMED`。

### 6.2 follow 验证与确认缺失

现状：服务器未验证“执行者确实关注了广告主”，因此不能：

- 推进 claim 状态到 `CONFIRMED/REJECTED`
- 产生真实消耗（frozen 扣减）与真实发放

### 6.3 结算（spend + pay + callback）缺失

现状：没有扣 frozen / spend ledger / payout / callback，因此广告主 Dashboard 的花费统计长期为 0。

### 6.4 ended 后预算退回（refund）缺失

现状：无法形成你最关心的到期分叉状态：

- 到期且用完（无需退）
- 到期未退（pending）
- 到期已退（refunded）

需要引入独立的 `budget_settlement_status`（第二维度）并实现 refund job（cron 或惰性结算 + 幂等）。

---

## 7. 下一步工作规划（按里程碑拆解，避免歧义）

### Milestone A（已完成）：把 follow v1 的“证据->确认->结算”打通

目标：从 “claim 占位” 推进到 “confirmed 后真实消耗 + 可对账”。

#### A1) 新增证据表（D1） ✅

新增表：`ad_claim_evidence`，用于存储执行者提交的证明材料（Profile Spotlight JSON 等）。

#### A2) 原子化 API：`POST /ads/executor/claim` ✅

输入：
- `ad_id` + `b_x_id` + `b_wallet`
- 可选证据：`proof_data` + `proof_type` + `category`

逻辑：
- 如果仅有基本信息：执行 **Claim**（占位/预约配额）。
- 如果携带证据：执行 **Submit Proof**（存证）并设置状态为 `PENDING_CONFIRM`。

#### A3) 验证与延迟结算（Cron Job） ✅

v1 策略：
- **延迟结算**：为了安全，提交证据后进入 24 小时冷却期（测试环境 1 小时）。
- **Cron 自动处理**：每 5 分钟扫描一次满足条件的 PENDING 记录。
- **原子结算**：`frozen_atomic` 扣减 -> `available_atomic` 增加 -> `status=CONFIRMED`。

验收标准：
- 执行者完成关注后，状态变为 `Pending Verification`。
- 冷却期过后，余额自动增加，状态变为 `Settled & Paid`。

### Milestone B：ended + refund（你关心的到期分叉）

#### B1) 新增 `budget_settlement_status`（第二维度）

建议枚举：
- `NOT_NEEDED`（locked 已全部消耗）
- `PENDING`（到期但未退回）
- `REFUNDED`
- `FAILED` / `RETRYING`（可选）

注意：它必须与 `AdCampaignStatus` 解耦，避免把“投放结束”与“资金结算完毕”混成一个枚举。

#### B2) refund job（cron 或惰性结算）

实现要求：
- 幂等（重复执行不会重复退钱）
- 并发安全（避免两个 job 同时退）

验收标准：
- 到期广告能从 `PENDING -> REFUNDED/NOT_NEEDED`
- 广告主可清晰看到“退没退/需不需要退”

### Milestone C：把广告主 UI 报表与账本口径对齐“已结算”

验收标准：
- Dashboard today/week spend 与 spend_history 能随 confirmed/settled 增长
- My Ads 的 `Claimed/Settled/Spent` 三列口径一致、不会误导

---

## 8. 已知实现偏差（需要后续修正的产品/实现点）

1) 目前 Profile 按钮在 `Eligible` 状态下点击会直接创建 claim（占位），并没有强制“先 follow 再 claim”。
   - 这是可以接受的暂态（因为后续 proof/confirm 会过滤掉未 follow 的 claim），但按钮文案会误导。
   - v1 建议：调整交互为“两步”：
     - 未关注：提示/引导用户先点击 X 的 Follow
     - 检测 following=true 后才允许 claim（占位）

2) Profile 按钮“未登录/未绑定”的专门 UI 状态还没做（当前是点击时报错）。
   - v1 建议：提前检测 CDP 登录态并给出 disabled 文案（减少无意义点击）。

---

## 9. 实现清单（方便快速定位改动）

### 9.1 Worker（Ads feed version）

- D1：`ads_feed_meta`：`tweetcat-x402-worker/tweetcattips/migrate.sql`
- DB helpers：`tweetcat-x402-worker/tweetcattips/src/database_ad.ts`
- API：`tweetcat-x402-worker/tweetcattips/src/api_srv_ads.ts`

### 9.2 Extension（缓存 + Profile 按钮）

- SW ads feed：`src/service_work/bg_ads_feed.ts`
- SW follow claim：`src/service_work/bg_ads_follow.ts`
- message dispatch：`src/service_work/bg_msg.ts`
- IndexedDB 表：`src/common/database.ts`
- Content button：`src/content/twitter_ui.ts`、`src/content/main_entrance.ts`

---

## 10. 广告广场（Ad Plaza）架构优化计划

Last updated: 2026-02-06

本节是关于"广告广场"（Executor 视角）的 UI/API 架构升级计划。目标是让执行者能更清晰地管理自己的任务进度，同时为平台规模化做好技术准备。

### 10.0 背景与问题

**当前实现的问题：**

| 问题 | 描述 |
|-----|-----|
| 全量加载 | `/ads/executor/list` 返回所有活跃广告，前端内存过滤"已领取"。广告数量大时性能差。 |
| My Tasks 依赖交叉过滤 | "我的任务"页签需要先加载全部广告 + 全部 Claims，再在前端做交集/差集。 |
| 分页缺失 | 无论是广告列表还是 My Tasks，都没有真正的分页支持。 |
| Activity 弹窗与 My Tasks 重复 | 两者数据源相似但 UI 割裂，用户困惑"该看哪个"。 |

**商业驱动：**

- **用户留存核心**："我的任务"是用户最常访问的功能，直接影响平台信任度。
- **规模化准备**：广告数量将从 50 增长到 5000+，必须提前做好架构。
- **未来功能基础**：任务提醒、进度追踪、奖励到账通知都依赖结构化的"我的任务"数据。

---

### 10.1 Phase 0：前端过滤（已完成）

**状态**：✅ 已实现

**实现内容**：

1. 广场页面增加 `Explore Ads` / `My Tasks` 双页签切换。
2. `Explore Ads`：过滤掉已领取的广告，只展示用户还没做过的。
3. `My Tasks`：只展示用户已领取（占位）的广告，按钮显示当前状态（CLAIMED / CONFIRMED 等）。
4. 用户 Claim 成功后弹窗引导跳转广场查看状态。

**代码变更**：

- `src/popup/ads/ad_executor_common.ts`：增加 `currentTab` 状态。
- `src/popup/ads/ad_executor_plaza.ts`：`filterAndSortAds` 根据 `currentTab` 分流；增加 Tab 切换事件。
- `src/content/twitter_ui.ts`：Claim 成功后 `showDialog` 带 callback 跳转广场。
- `dist/html/ad_plaza.html`：增加 `.plaza-tabs` HTML 结构。
- `dist/css/ad_plaza.css`：增加 Tab 样式 + 已领取卡片绿色高亮。

**局限性**：

- 依赖前端内存过滤，不适合大规模广告。
- My Tasks 无法独立分页。

---

### 10.2 Phase 1：后端新增 `/ads/executor/my_tasks` API

**状态**：✅ 已完成

**目标**：为 `My Tasks` 页签提供专属、轻量、可分页的数据源。

#### 10.2.1 API 设计

**路径**：`GET /ads/executor/my_tasks`

**请求参数**：

| 参数 | 类型 | 必填 | 说明 |
|-----|------|-----|-----|
| `b_x_id` | string | ✅ | 执行者 X ID |
| `status` | string | ❌ | 可选筛选：`all` / `pending` / `confirmed` / `rejected`，默认 `all` |
| `limit` | number | ❌ | 分页大小，默认 20，最大 100 |
| `offset` | number | ❌ | 分页偏移，默认 0 |

**响应结构**：

```json
{
  "success": true,
  "tasks": [
    {
      "claim_id": "uuid",
      "ad_id": "uuid",
      "status": "CLAIMED",
      "created_at": "2026-02-06T12:00:00Z",
      "expires_at": "2026-02-07T12:00:00Z",
      "ad": {
        "title": "Follow @example",
        "brand": "@example",
        "category": "follow",
        "rewardUSDC": 0.5,
        "detailUrl": "https://x.com/example"
      }
    }
  ],
  "total": 42,
  "hasMore": true
}
```

#### 10.2.2 后端实现

**文件**：`tweetcat-x402-worker/tweetcattips/src/api_srv_ads.ts`

**新增函数**：`apiAdsMyTasks`

**文件**：`tweetcat-x402-worker/tweetcattips/src/database_ad.ts`

**新增函数**：`getPerformerTasksWithAdInfo`, `getPerformerTasksCount`

#### 10.2.3 前端集成

**文件**：`src/popup/ads/ad_executor_plaza.ts`

**变更**：

1. `My Tasks` 页签切换时，改为调用 `/ads/executor/my_tasks` 而非前端过滤。
2. 增加加载状态（Loading / Error / Empty）。
3. `Explore Ads` 继续使用原有 `/ads/executor/list`。

**文件**：`src/popup/ads/ad_publisher_common.ts`

**新增常量**：`API_PATH_ADS_MY_TASKS`

#### 10.2.4 验收标准

- [ ] `My Tasks` 页签能独立加载数据，无需等待全量广告列表。
- [ ] 列表正确显示任务状态（CLAIMED / CONFIRMED / REJECTED）。
- [ ] 空状态和加载状态 UI 正常。

---

### 10.3 Phase 2：分页与筛选

**状态**：✅ 已完成

**目标**：为大规模数据提供分页控件和状态筛选。

#### 10.3.1 前端 UI

1. 页签下方增加状态筛选下拉框：`All` / `Pending` / `Confirmed` / `Rejected`。
2. 列表底部增加分页控件："上一页 / 下一页 / 第 N 页"。
3. 空状态优化：
   - `Explore Ads` 空：显示"暂无可领取的广告"。
   - `My Tasks` 空：显示"您还没有参与任何任务，快去广场看看吧！"

#### 10.3.2 验收标准

- [ ] 状态筛选能正确过滤任务列表。
- [ ] 分页控件与后端 `limit/offset` 联动正常。
- [ ] 切换筛选/页码时有 Loading 状态。

---

### 10.4 Phase 3：用户运营扩展

**状态**：📋 未来规划

**目标**：基于 My Tasks 数据源，扩展用户运营能力。

#### 10.4.1 任务进度追踪

- 在任务卡片上显示：任务创建时间 / 预计验证时间 / 已验证时间。
- 增加"任务详情页"（可选）。

#### 10.4.2 推送通知

- 任务状态变更时推送浏览器通知。
- 奖励到账时推送通知（需要后端 webhook 或轮询）。

#### 10.4.3 活动激励

- 基于 My Tasks 数据实现"本周完成 5 个任务送 Bonus"等运营活动。
- 在广场首页增加活动 Banner。

---

### 10.5 实施时间线

| 阶段 | 预估工时 | 依赖 |
|-----|---------|-----|
| Phase 0 | ✅ 已完成 | - |
| Phase 1 | ✅ 已完成 | Phase 0 |
| Phase 2 | ✅ 已完成 | Phase 1 |
| Phase 3 | 未定 | Phase 2 + 产品需求确认 |

---

随着 **Milestone A（延迟结算闭环）** 的全部完成，整个广告流程从投放、展示、领取到自动结算已经打通。

接下来，我们将进入 **Milestone B（已完成）**，解决“到期退款”与“预算管理”的问题：

**Milestone B (Ended + Refund) ✅**

1.  **B1) 自动结算/到期任务**：✅
    *   定期扫描过期广告，将状态标记为 `EXPIRED`。
2.  **B2) 预算退回 (Refund)**：✅
    *   对于已结束且不再有 Pending 任务的广告，将剩余 `frozen_atomic` 退回给广告主的 `available_atomic`。
3.  **B3) 状态细化**：✅
    *   引入 `budget_settlement_status`，区分“待退款 / 已退款”。

接下来，我们将进入 **Milestone C**，完善广告主的账单展示。

请参考 **Section 7** 获取详细的技术实现方案。

---

### 10.6 代码变更清单

| 阶段 | 后端文件 | 前端文件 |
|-----|---------|---------|
| Phase 0 | - | `ad_executor_common.ts`, `ad_executor_plaza.ts`, `twitter_ui.ts`, `ad_plaza.html`, `ad_plaza.css` |
| Phase 1 | `api_srv_ads.ts`, `database_ad.ts`, `common.ts` | `ad_executor_plaza.ts`, `ad_publisher_common.ts` |
| Phase 2 | - | `ad_executor_plaza.ts`, `ad_plaza.html`, `ad_plaza.css` |
