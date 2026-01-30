# TweetCat 研发目标 (V1)：蓝微关注自动清算系统

## 1. 任务定义 (Task Definition)
实现“关注即领赏”的自动化闭环。
*   **触发源 (V1)**：TweetyCat 浏览器插件在 Twitter 页面注入一个“关注领奖 / Follow & Claim”按钮；用户点击该按钮后，插件触发后续见证与清算流程。
    *   **备注 (V2 方向)**：再考虑“无感触发”（拦截原生 Follow 请求 / 点击事件）作为体验优化，但 V1 先以可控、可调试的显式触发为主。
*   **角色定义（当前阶段：官方 Notary 单签）**：
    *   **Local App（ATA Miner）= Prover**：只做证明发起方与请求执行方（不签名、不当 Notary）。
    *   **官方 Notary Server = Notary**：唯一见证与签发方（单签），与 Prover 组成 2-of-2 MPC 参与方。
*   **见证能力（当前阶段）**：
    *   ATA Miner **必须**：模拟 TLS 1.3 指纹/请求、与官方 Notary 共同协商 TLS 会话密钥分片（2-of-2 MPC）、并向 Notary 上传/镜像 TLS 密文拷贝。
    *   Notary **负责**：校验密文真实性（MAC/绑定关系）并签发证明/回执。
*   **清算逻辑**：Notary 签发证明 -> 业务服务器验签 -> 发放奖金 -> 平台扣除 10% 分成 -> 存证。

---

## 2. 核心组件开发

### 阶段一：插件端证据捕捉与桥接 (Extension & Native Bridge)
*   **任务**：
    1.  **Content Script UI**：在 Twitter 用户页 / 任务页注入“关注领奖 / Follow & Claim”按钮与状态提示（进行中 / 成功 / 失败）。
    2.  **指令上报**：按钮点击后，Content Script 将任务信息（`task_id`、目标 `screen_name/rest_id`、当前页面 URL、UA）发送给 `service_worker`。
    3.  **会话收集（在 service_worker）**：
        *   通过 `chrome.cookies` 在扩展后台读取 `twitter.com` / `x.com` 的会话 Cookie（包含 `HttpOnly`，例如 `auth_token`、`ct0` 等）。
        *   组合 ATA Miner（Prover）发起请求所需的最小上下文：UA、Accept-Language、必要的 Header 片段（如 `x-csrf-token` 由 `ct0` 派生/复用）与目标参数。
        *   说明：Content Script 无法直接读取 `HttpOnly` Cookie，必须由扩展后台 API 完成读取与下发。
    4.  **Native Messaging**：`service_worker` 通过 Native Messaging 把“执行指令 + 会话上下文”发送给 Local App（ATA Miner/Prover），并监听其回传（成功/失败 + trace_id + Notary 回执摘要）。
    5.  **提交证明**：`service_worker` 将 Notary 签发的证明/回执提交到业务服务器（或由 ATA Miner 直传业务服务器，二选一）。
    6.  **结果回写 UI**：业务服务器 -> `service_worker` -> Content Script，更新按钮状态，并可提示“验证成功 / 等待入账”。
*   **验证标准**：
    *   ATA Miner 能收到完整且可用的会话上下文，并能回传结构化执行结果到插件；
    *   业务服务器能验签 Notary 证明并完成一次结算闭环。

### 阶段二（当前阶段）：ATA Miner（Prover）与官方 Notary 的 MPC-TLS (MPC-TLS Engine)
*   **任务**：
    1.  **Prover（ATA Miner）**：
        *   模拟浏览器 TLS 1.3 指纹/请求（JA3/HTTP2/头部等策略按实现选型），使用用户本机网络直连 X/Twitter。
        *   与官方 Notary Server 进行 2-of-2 MPC 协议：双方各持密钥分片（例如 Prover 持 $r_1$，Notary 持 $r_2$），共同派生会话密钥材料。
    2.  **Notary（官方服务器）**：
        *   参与 MPC、参与会话密钥派生、并对镜像密文做真实性校验（MAC/绑定关系）。
    3.  **执行关注动作（由 Prover 发起）**：
        *   ATA Miner 使用插件下发的会话上下文，直接向 Twitter API 发起“关注”请求（例如 `i/api/1.1/friendships/create.json` 或对应 GraphQL/REST 路径）。
        *   关键点：请求必须携带与浏览器一致的 Cookie / CSRF（`ct0` -> `x-csrf-token`）/ 必要 Header，以确保服务器按真实用户会话处理。
    4.  **密文镜像**：ATA Miner 直连 Twitter，同时将上/下行的 TLS 密文流（或必要片段）实时镜像/上传给官方 Notary Server。
*   **验证标准**：Notary 能校验镜像密文来自真实 TLS 流，并能定位到“关注接口响应”对应的加密记录。

#### 阶段二（工程落地：macOS 本地 App 方案 A / 最小闭环）
*   **工程类型**：Xcode `Command Line Tool` 或 `Swift Package`（产物为一个可执行文件），作为 **Native Messaging Host（STDIO）** 运行。
*   **职责边界**：
    1.  接收扩展通过 Native Messaging 发送的 JSON 指令（如 `ping`、`follow_claim`），返回 JSON 结果（含 `ok/error_code/trace_id`）。
    2.  执行 Prover 侧 MPC-TLS + 真实请求 + 密文镜像（不做 Notary 签名）。
    3.  默认不落盘保存敏感会话（`auth_token/ct0`），日志需脱敏；仅在显式 debug 开关下允许更详细输出。
*   **可选**：后续再加 macOS UI App（SwiftUI）用于安装/升级 host manifest、展示状态与日志，但不阻塞 V1 闭环。

### 阶段三：选择性披露与证明签发 (Attestation Generation)
*   **任务**：
    1.  **锚点数据选择（V1）**：以“关注接口响应成功”为主锚点（例如响应中包含 `following: true` / `errors: []` / HTTP 200 等可判定字段）。
        *   可选增强：再追加一次“关注关系查询”作为二次锚点（例如 `UserByScreenName/UserByRestId` 的 relationship 字段），但不是 V1 必选。
    2.  Prover（ATA Miner）提供目标字段偏移量与解密分片（按协议），Notary 验证分片合法性并解出必要明文字段，确认“关注成功”事实。
    3.  Notary 签发 **EIP-712 结构化证明**（含 `task_id`、执行者地址、目标用户标识、结论、时间戳、证明摘要）。
*   **验证标准**：生成一份可被业务服务器验签（`ecrecover`）的 EIP-712 证明，并能从中复核出“本次关注动作已成功发生”。

### 阶段四：业务服务器结算与分账 (Settlement & Revenue)
*   **任务**：
    1.  业务服务器接收证明，调用 `ecrecover` 核实见证人身份。
    2.  触发清算：从广告主余额中扣款。
        *   **90%**：发送至执行用户钱包。
        *   **10%**：转入平台 USDC 收益地址。
    3.  **存证记录**：将密文镜像摘要与 Notary 证明关联，保存至后端，供广告主后台查阅与审计。
*   **验证标准**：模拟一笔 10 USDC 的任务，用户收到 9 USDC，平台账户增加 1 USDC，数据库可见完整证据链。

---

## 3. 研发时间线建议
1.  **Week 1**: 完善 Native Messaging 桥接与 Miner App 指令集。
2.  **Week 2**: MPC-TLS 握手协议联调（Prover/ATA Miner <-> 官方 Notary）。
3.  **Week 3**: 密文镜像与选择性披露/证明签发集成，端到端联调。
4.  **Week 4**: 业务服务器结算逻辑与 x402 模拟集成，端到端全链路测试。

---

## 4. 关键风险评估
*   **Twitter API 变动**：需确保“锚点 API / 上下文窗口匹配”等策略具备足够的鲁棒性。
*   **Cookie/权限问题**：`HttpOnly` Cookie 只能由扩展后台读取；需要正确的 host permissions，并处理 `twitter.com`/`x.com` 域名差异。
*   **连接稳定性**：需处理 ATA Miner 离线、MPC 握手失败或网络抖动的重试机制。
*   **风控与封号风险**：指纹模拟与请求频率必须保守；必要时加入“只在用户主动点击按钮时执行”的硬约束与节流。

---

## 5. 未来阶段：见证能力下沉（MPC-TLS / Notary）
在“官方 Notary 单签”跑通后，再将 Notary 角色从“官方服务器”逐步扩展到“节点/本地 App”：
1.  **Notary 多活/多签**：从单签升级到多 Notary/委员会签名，降低单点风险。
2.  **P2P Notary（去中心化）**：引入 B 的 Local App 作为 Notary（随机匹配/质押/惩罚），A 的 ATA Miner 仍为 Prover。
3.  **隐私与最小披露**：在更复杂 JSON/个性化内容场景，强化最小披露策略与可审计性。
