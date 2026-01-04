# TweetCatTips (Cloudflare Worker) — x402 Tip API

TweetCatTips 是一个运行在 Cloudflare Workers 上的 x402 收款/打赏服务。

- `GET /tip`：发起/完成一次 x402 打赏（生产=Base Mainnet；测试=Base Sepolia）
- `GET /user-info`：查询 CDP end-user 信息
- `GET /health`：健康检查

> Worker（生产）名称：`tweetcattips`
> 你重构前/早期使用的域名：`https://tweetcattips.ribencong.workers.dev`

---

## 1) 环境与入口文件

本项目通过 Wrangler 的 `env` + 不同入口文件区分环境：

- **生产（Production / 主网）**
	- 入口文件：`src/index.ts`
	- Worker 名：`tweetcattips`

- **测试（Dev / 测试网）**
	- 入口文件：`src/index-dev.ts`
	- Worker 名：`tweetcattips-dev`（来自 `wrangler.jsonc` 的 `env.dev.name`）

---

## 2) 安装依赖 & 登录 Cloudflare

```bash
npm install
npx wrangler login
```

---

## 3) 本地运行（Local）

### 3.1 本地运行生产版本（主网逻辑）

```bash
npx wrangler dev
```

Wrangler 通常会启动在：
- `http://127.0.0.1:8787`

示例：
- `http://127.0.0.1:8787/health`
- `http://127.0.0.1:8787/tip?payTo=0x...&amount=0.01`
- `http://127.0.0.1:8787/user-info?userId=x:12345`

### 3.2 本地运行测试版本（测试网逻辑）

```bash
npx wrangler dev --env dev
```

示例：
- `http://127.0.0.1:8787/health`
- `http://127.0.0.1:8787/tip?payTo=0x...&amount=0.01`
- `http://127.0.0.1:8787/user-info?userId=x:12345`

---

## 4) 部署（Deploy）

### 4.1 部署生产版本（主网）

```bash
npx wrangler deploy
```

部署成功后域名通常类似：
- `https://tweetcattips.<your-subdomain>.workers.dev`

你历史上用过（生产）域名：
- `https://tweetcattips.ribencong.workers.dev`

生产 API 示例：
- `GET https://tweetcattips.ribencong.workers.dev/health`
- `GET https://tweetcattips.ribencong.workers.dev/tip?payTo=0x...&amount=0.01`
- `GET https://tweetcattips.ribencong.workers.dev/user-info?userId=x:12345`

### 4.2 部署测试版本（测试网）

```bash
npx wrangler deploy --env dev
```

部署成功后域名通常类似：
- `https://tweetcattips-dev.<your-subdomain>.workers.dev`

测试 API 示例：
- `GET https://tweetcattips-dev.<your-subdomain>.workers.dev/health`
- `GET https://tweetcattips-dev.<your-subdomain>.workers.dev/tip?payTo=0x...&amount=0.01`
- `GET https://tweetcattips-dev.<your-subdomain>.workers.dev/user-info?userId=x:12345`

> 最终测试域名以 `wrangler deploy --env dev` 输出为准。

---

## 5) 客户端如何访问不同环境的 API

客户端只需要切换 **Base URL**（路径保持一致）：

### 5.1 生产（主网）

- Base URL：`https://tweetcattips.ribencong.workers.dev`
- Tip：`GET /tip?payTo=0x...&amount=0.01`
- User Info：`GET /user-info?userId=x:12345`

示例：
```text
https://tweetcattips.ribencong.workers.dev/tip?payTo=0xE400dfed2E03D5AFE012cCB4b4cAa74bfdB5A257&amount=0.01
```

### 5.2 测试（测试网）

- Base URL：`https://tweetcattips-dev.<your-subdomain>.workers.dev`
- Tip：`GET /tip?payTo=0x...&amount=0.01`
- User Info：`GET /user-info?userId=x:12345`

示例：
```text
https://tweetcattips-dev.<your-subdomain>.workers.dev/tip?payTo=0xE400dfed2E03D5AFE012cCB4b4cAa74bfdB5A257&amount=0.01
```

### 5.3 本地（Local）

- Base URL：`http://127.0.0.1:8787`
- Tip：`GET /tip?payTo=0x...&amount=0.01`

示例：
```text
http://127.0.0.1:8787/tip?payTo=0xE400dfed2E03D5AFE012cCB4b4cAa74bfdB5A257&amount=0.01
```

---

## 6) x402 请求流程（客户端要点）

1) **第一次请求（不带支付头）**：服务端返回 `402 Payment Required`
	- Header：`PAYMENT-REQUIRED: <base64(json)>`

2) **客户端完成支付/签名后再次请求（带支付头）**：服务端会验证并结算
	- 请求 Header（服务端兼容以下任意一个）：
		- `PAYMENT-SIGNATURE`
		- `Payment-Signature`
		- `PAYMENT`
		- `Payment`
	- 响应 Header：`PAYMENT-RESPONSE: <base64(json settleResult)>`
	- 响应 Body：包含 `success / txHash / payer` 等字段


## database
	-wrangler d1 execute tweetcat_db_test --file=a.sql --remote  --env dev
	-wrangler d1 execute tweetcat_db --file=a.sql --remote
	-npx wrangler secret put CDP_WALLET_SECRET --env dev
	-SELECT name, type, sql
	FROM sqlite_master
	WHERE tbl_name = 'user_rewards'
	ORDER BY type, name;
