# 重构方案：MVP Follow-Only 广告发布

Created: 2026-02-09

## 1. 目标与第一性原理

### 1.1 商业本质
广告主的核心需求是：**吸引高质量（蓝V）用户关注自己的 X 账号，并为此付费**。

### 1.2 MVP 核心功能
1. **单一广告类型**：仅 `follow` 关注广告，移除 `visit`、`register`、`share`。
2. **明确目标对象**：广告主 = 被关注人，执行者 = 蓝V 用户（只有蓝V才能参与）。
3. **简化发布流程**：一页式表单，去掉多步骤 Wizard。
4. **明确预算模型**：单价 × 人数上限 = 锁定预算；有截止日期。

---

## 2. 当前架构分析

### 2.1 前端结构 (Publisher)

| 文件 | 职责 |
|-----|-----|
| `ad_advertise.html` | 发布 Wizard UI（4步：Basic -> Creative -> Task -> Budget） |
| `ad_publisher_ads.ts` | Wizard 逻辑：步骤切换、校验、提交 |
| `ad_publisher_dashboard.ts` | 广告列表、Dashboard 卡片、Detail Modal |
| `ad_publisher_common.ts` | API 路径、状态管理、工具函数 |
| `ad_publisher_balance.ts` | 充值/提现模态框 |

### 2.2 后端结构 (Worker)

| 文件 | 职责 |
|-----|-----|
| `api_srv_ads.ts` | API 路由：create, list, toggle, update, claim 等 |
| `database_ad.ts` | D1 CRUD：`ad_campaigns`, `ad_reward_claims`, `ad_escrow_accounts` |

### 2.3 当前 `ad_campaigns` 表关键字段

```sql
ad_id, a_x_id, category, name, title, description,
detail_url, image_url, callback_url, custom_data,
unit_price_atomic, quota_total, quota_claimed, quota_used,
status, end_date, created_at, updated_at
```

---

## 3. 重构方案

### 3.1 前端变更

#### 3.1.1 HTML (`ad_advertise.html`)

**Before (4-Step Wizard):**
- Step 1: Ad Name, Category (follow/visit/register/share)
- Step 2: Title, Description, Image, URL
- Step 3: Reward, Task Limit, End Date, Callback, Custom Data
- Step 4: Budget Summary

**After (Single-Form):**
```html
<div class="publish-form">
  <div class="form-group">
    <label>Campaign Name</label>
    <input id="ad-name" placeholder="My Follow Campaign" />
  </div>
  <div class="form-group">
    <label>Reward per Follower (USDC)</label>
    <input id="reward-amount" type="number" step="0.01" min="0.01" />
  </div>
  <div class="form-group">
    <label>Max Followers (quota)</label>
    <input id="task-limit" type="number" min="1" />
  </div>
  <div class="form-group">
    <label>End Date</label>
    <input id="end-date" type="datetime-local" />
  </div>
  <div class="form-summary">
    <p>Total Budget: <span id="summary-total">0.00</span> USDC</p>
    <p>Your Balance: <span id="current-balance">0.00</span> USDC</p>
  </div>
  <button id="btn-publish">Pay & Publish</button>
</div>
```

**移除:**
- Category 下拉框（固定为 `follow`）
- Title / Description / Image URL（不需要创意素材）
- Callback URL / Custom Data（MVP 不需要）
- 4-Step Wizard 指示器

#### 3.1.2 TypeScript (`ad_publisher_ads.ts`)

**Before:**
- `wizardCurrentStep`, `wizardMaxStep`
- `goWizardNext()`, `goWizardPrev()`
- 4 步校验逻辑

**After:**
```typescript
async function submitPublishForm() {
  const name = $input("ad-name").value.trim();
  const reward = parseFloat($input("reward-amount").value);
  const quota = parseInt($input("task-limit").value);
  const endDate = new Date($input("end-date").value);

  // Validation
  if (!name) return showError("Name required");
  if (reward <= 0) return showError("Reward must > 0");
  if (quota <= 0) return showError("Quota must > 0");
  if (endDate <= new Date()) return showError("End date must be in future");

  // 自动填充 detail_url 为当前用户的 X Profile
  const detailUrl = `https://x.com/${getCurrentXUserName()}`;

  const payload = {
    a_x_id: getCurrentXId(),
    category: "follow", // 固定
    name,
    title: name, // 复用 name
    description: `Follow @${getCurrentXUserName()} to earn`,
    detail_url: detailUrl,
    unit_price_atomic: usdcToAtomic(reward.toString()),
    quota_total: quota,
    end_date: endDate.toISOString(),
  };

  await x402WorkerFetch(API_PATH_ADS_CREATE, payload);
  showSuccess("Ad Published!");
}
```

**移除:**
- Wizard 相关代码
- 多步校验

#### 3.1.3 Dashboard 简化 (`ad_publisher_dashboard.ts`)

**保留:**
- My Ads 列表（名称、状态、Reward、Claimed、Settled、Spent、End Date、Actions）
- 余额卡片（Available / Frozen）
- 充值/提现

**简化 Detail Modal:**
- 移除 Title/Description/Image 展示
- 仅显示：Name, Status, Reward, Quota, End Date, Actions (Pause/Resume/TopUp)

---

### 3.2 后端变更

#### 3.2.1 API (`api_srv_ads.ts`)

**`POST /ads/create` 改动:**

```typescript
// 强制 category = 'follow'
if (category !== 'follow') {
  return jsonError(c, 400, "INVALID_CATEGORY", "Only follow ads are supported");
}

// detail_url 必须匹配 a_x_id 的 profile
// detail_url = https://x.com/<a_x_username>
// 可选：后端自动生成 detail_url，无需前端传
```

**新增字段校验 (Executor 领取时):**
```typescript
// 在 apiAdsClaim 中增加蓝V校验
const executorProfile = await getExecutorProfile(bXId); // 从 kol_binding 或 X API
if (!executorProfile.is_blue_verified) {
  return jsonError(c, 403, "NOT_VERIFIED", "Only Blue Verified users can claim");
}
```

#### 3.2.2 数据库 (`database_ad.ts`)

**无需 Schema 变更**（现有 `ad_campaigns` 足够）

可选清理：
- 后端默认 `title = name`，`description = 自动生成`
- `image_url`, `callback_url`, `custom_data` 设为 NULL

---

### 3.3 执行者端变更

#### 3.3.1 蓝V 资格校验

**方案 A：前端校验（快速但易绕过）**
- 在 Content Script 中，Profile 按钮渲染前检查当前用户 `is_blue_verified`
- 若非蓝V，不显示按钮

**方案 B：后端校验（推荐）**
- 领取时（`/ads/executor/claim`）后端校验 `b_x_id` 是否蓝V
- 若非蓝V，返回 403

**数据来源:**
- `kol_binding` 表新增 `is_blue_verified BOOLEAN DEFAULT FALSE`
- 用户登录/绑定时从 X API 拉取并存储

#### 3.3.2 Ad Plaza UI 简化

**保留:**
- Explore Ads 页签（只展示 follow 广告）
- My Tasks 页签

**移除:**
- Category 筛选器（只有一种类型）
- 复杂的卡片信息（只保留：Target Account, Reward, Status）

---

## 4. 实施步骤

### Phase 1: 后端约束 (1h) ✅ 已完成
- [x] `apiAdsCreate`: 强制 `category = 'follow'`
- [x] 后端自动填充 `title`, `description`, `detail_url`（前端可不传）
- [ ] `apiAdsClaim`: 增加蓝V校验（暂用 mock，后续补真实数据）

### Phase 2: 前端发布表单重构 (2h) ✅ 已完成
- [x] `ad_advertise.html`: 替换 Wizard 为单页表单
- [x] `ad_publisher_ads.ts`: 重写提交逻辑，移除 Wizard 代码
- [x] `ad_advertise.css`: 添加新表单样式
- [x] 自动填充 `detail_url` = 后端默认处理

### Phase 3: Dashboard 简化 (1h) ✅ 已完成
- [x] Detail Modal: 移除 Title/Description/Image 展示
- [x] 移除残留的 category 相关 UI

### Phase 4: 执行者端适配 (1h) ✅ 已完成
- [x] Ad Plaza: 移除 Category 筛选
- [x] Profile 按钮: 添加蓝V校验前置检查 (startTask)
- [x] Check 1: 本地存储蓝V状态 (inject -> content -> background -> storage)
- [x] Check 2: 领取前校验本地状态 & 拦截点击跳转 (ad_executor_plaza.ts)
- [x] UI: Ad Plaza 显示当前用户 Verification Status
- [x] UX: 允许发布者修改 Target Profile URL (ad_advertise.html)

### Phase 5: 蓝V 数据补全 (后续)
- [ ] `kol_binding` 表 `ALTER ADD COLUMN is_blue_verified` (后端暂未做，前端已实现检查)
- [x] 用户绑定/浏览时调用 X API 获取 `is_blue_verified` (通过 inject 实现)
- [ ] 后端领取校验切换为真实数据 (暂依赖前端校验)

---

## 5. 风险与回退

| 风险 | 缓解措施 |
|-----|---------|
| 蓝V API 限流 | 缓存 + 定期刷新 |
| 老广告兼容 | 保留 DB schema，仅在 API 层约束 |
| 用户困惑 | 表单明确说明"仅限蓝V用户参与" |

---

## 6. 验收标准

1. 广告主发布一键完成（无 Wizard 跳转）
2. 只能创建 follow 类型广告
3. 执行者非蓝V时无法领取（返回清晰错误）
4. My Ads 列表正常展示新广告
5. 预算锁定/结算/退款流程不受影响
