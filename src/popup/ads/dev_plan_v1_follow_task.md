# TweetCat 研发目标 (V1)：蓝微关注自动清算系统

## 1. 任务定义 (Task Definition)
实现“关注即领赏”的自动化闭环。
*   **触发源 (V1)**：TweetyCat 浏览器插件在 Twitter 页面注入一个“关注领奖 / Follow & Claim”按钮；用户点击该按钮后，插件触发后续见证与清算流程。
    *   **备注 (V2 方向)**：再考虑“无感触发”（拦截原生 Follow 请求 / 点击事件）作为体验优化，但 V1 先以可控、可调试的显式触发为主。
*   **见证者**：官方 Notary Server (作为唯一 2-of-2 MPC 参与方)。
*   **清算逻辑**：验证成功 -> 业务服务器发放奖金 -> 平台扣除 10% 分成 -> 存储证据存证。

---

## 2. 核心组件开发

### 阶段一：插件端证据捕捉与桥接 (Extension & Native Bridge)
*   **任务**：
    1.  **Content Script UI**：在 Twitter 用户页 / 任务页注入“关注领奖 / Follow & Claim”按钮与状态提示（进行中 / 成功 / 失败）。
    2.  **指令上报**：按钮点击后，Content Script 将任务信息（`task_id`、目标 `screen_name/rest_id`、当前页面 URL、UA）发送给 `service_worker`。
    3.  **会话收集（在 service_worker）**：
        *   通过 `chrome.cookies` 在扩展后台读取 `twitter.com` / `x.com` 的会话 Cookie（包含 `HttpOnly`，例如 `auth_token`、`ct0` 等）。
        *   组合 Miner 发起请求所需的最小上下文：UA、Accept-Language、必要的 Header 片段（如 `x-csrf-token` 由 `ct0` 派生/复用）与目标参数。
        *   说明：Content Script 无法直接读取 `HttpOnly` Cookie，必须由扩展后台 API 完成读取与下发。
    4.  **Native Messaging**：`service_worker` 通过 Native Messaging 把“执行指令 + 会话上下文”发送给 Local Miner App，并监听 Miner 回传的结果（成功/失败 + 证明摘要）。
    5.  **结果回写 UI**：Miner -> `service_worker` -> Content Script，更新按钮状态，并可提示“已提交证明 / 等待入账”。
*   **验证标准**：Miner App 能收到完整且可用的会话上下文，并能回传结构化执行结果到插件 UI。

### 阶段二：Local Miner 与服务器 MPC 通讯 (MPC-TLS Engine)
*   **任务**：
    1.  **Miner 侧**：实现基于 Rust 的 TLS 1.3 状态机（或可替换实现），与 Notary Server 发起 2-of-2 MPC 握手，联合派生会话密钥分片。
    2.  **Server 侧**：实现 Notary 见证服务，分发随机数 $r_2$，参与 Session Key 派生与 MAC 校验。
    3.  **执行关注动作（由 Miner 发起）**：
        *   Miner 使用插件下发的会话上下文，直接向 Twitter API 发起“关注”请求（例如 `i/api/1.1/friendships/create.json` 或对应 GraphQL/REST 路径），而不是依赖用户点击原生 Follow。
        *   关键点：请求必须携带与浏览器一致的 Cookie / CSRF（`ct0` -> `x-csrf-token`）/ 必要 Header，以确保服务器按真实用户会话处理。
    4.  **流量镜像**：Miner 直连 Twitter，同时将上/下行的原始加密字节流（密文）实时镜像给 Notary。
*   **验证标准**：Notary 能通过 MAC 校验确认镜像密文来自真实 TLS 流，并能定位到“关注接口响应”对应的加密记录。

### 阶段三：选择性披露与证明签发 (Attestation Generation)
*   **任务**：
    1.  **锚点数据选择（V1）**：以“关注接口响应成功”为主锚点（例如响应中包含 `following: true` / `errors: []` / HTTP 200 等可判定字段）。
        *   可选增强：再追加一次“关注关系查询”作为二次锚点（例如 `UserByScreenName/UserByRestId` 的 relationship 字段），但不是 V1 必选。
    2.  Miner 提供目标字段偏移量与解密分片；Notary 验证分片合法性并解出必要明文字段，确认“关注成功”事实。
    3.  Notary 签发 **EIP-712 结构化证明**（含 `task_id`、执行者地址、目标用户标识、结论、时间戳、证明摘要）。
*   **验证标准**：生成一份可被业务服务器验签（`ecrecover`）的 EIP-712 证明，并能从中复核出“本次关注动作已成功发生”。

### 阶段四：业务服务器结算与分账 (Settlement & Revenue)
*   **任务**：
    1.  业务服务器接收证明，调用 `ecrecover` 核实见证人身份。
    2.  触发清算：从广告主余额中扣款。
        *   **90%**：发送至执行用户钱包。
        *   **10%**：转入平台 USDC 收益地址。
    3.  **存证记录**：将加密流量镜像摘要与证明关联，保存至后端，供广告主后台查阅。
*   **验证标准**：模拟一笔 10 USDC 的任务，用户收到 9 USDC，平台账户增加 1 USDC，数据库可见完整证据链。

---

## 3. 研发时间线建议
1.  **Week 1**: 完善 Native Messaging 桥接与 Miner App 指令集。
2.  **Week 2**: MPC-TLS 握手协议联调（Miner <-> Notary）。
3.  **Week 3**: 流量镜像与选择性解密算法集成。
4.  **Week 4**: 业务服务器结算逻辑与 x402 模拟集成，端到端全链路测试。

## 4. 关键风险评估
*   **Twitter API 变动**：需确保“锚点 API / 上下文窗口匹配”等策略具备足够的鲁棒性。
*   **Cookie/权限问题**：`HttpOnly` Cookie 只能由扩展后台读取；需要正确的 host permissions，并处理 `twitter.com`/`x.com` 域名差异。
*   **连接稳定性**：由于是异步见证，需处理 Miner App 离线、MPC 握手失败或网络抖动的重试机制。
