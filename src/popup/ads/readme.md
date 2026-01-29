# ATA (Asynchronous TLS Attestation) & Social Mining 技术白皮书

## 0. 执行摘要 (Executive Summary)
本方案针对 Web3 社交场景中“链外行为可信验证”的 Oracle 瓶颈，提出了一种全新的 **ATA (异步 TLS 见证)** 协议。通过将 **MPC 多方计算** 与 **本地原生中继 (Social Miner)** 相结合，在不依赖 Web2 平台 API、不侵犯用户隐私、不产生明显感知延迟的前提下，将 TLS 协议的信任链直接延伸至区块链智能合约。

---

## 1. 核心大纲 (General Outline)

1.  **[设计哲学] 信任锚点的迁移**：从“中心化中介”到“去中心化数学协议”的飞跃，实现 **Oracle-less (无预言机)** 验证。
2.  **[技术架构] 三级火箭验证体系**：
    *   **TweetyCat Extension**: 环境感知与 **Evidence Snapshot (证据快照)** 提取。
    *   **Social Miner (本地 Native App)**: 协议执行中心，实现 **Breaking Symmetric MAC (打破对称 MAC 指纹)** 的抗伪造性。
    *   **DeNotary P2P 网络**: 分布式见证，实现 **Selective Decryption without Circuits (无需电路的选择性解密)**。
3.  **[技术详解] ATA 协议全生命周期解析**
4.  **[经济模型] 社交挖矿：行为挖矿与中继挖矿的博弈**
5.  **[学术维度] 论文支撑框架与异构协议桥接论证**

---

## 2. 技术实现深度描述 (Detailed Implementation)

### 2.1 核心基石：2-of-2 MPC 密钥切片与“对称性破解”
为了实现“双向不信任”的安全承诺，ATA 协议在 TLS 握手的底层进行了重构：
*   **非对称密钥碎片**：在 DHE 密钥交换过程中，插件端（Prover）生成随机数 $r_1$，公证方（Notary）生成 $r_2$。
*   **联合生成密钥**：通过 MPC 算法，双方在互不告知分片的前提下，共同生成 TLS 会话的对称加密密钥（Session Key）。
*   **打破对称性安全 (Breaking Symmetry)**：在标准 TLS 中，由于加密是对称的（AES-GCM），拥有密钥的 Prover 可以随意伪造数据。但在 ATA 中，由于密钥是碎片化的，Prover 在没有 Notary 协助的情况下无法计算出正确的 **Auth Tag (MAC)**。这意味着：**任何能通过验证的密文流，在数学概率上必然、且只能来源于 Twitter 的服务器。** 这就是“Oracle-less”验证的公信力来源。

### 2.2 物理层突破：Social Miner（本地社交挖矿机）
解决浏览器沙盒物理限制的终极武器：
*   **Native Messaging 桥接**：插件通过原生消息管道与独立运行的 `miner.exe/app` 通信。
*   **TCP 发射与指纹模拟**：Miner App 拥有开启原生 TCP 端口的权限，能够精确模拟浏览器的 TLS 指纹（JA3），使该请求在 Twitter 看来完全是用户在真实浏览器中的原生操作。
*   **家庭 IP 出口 (Residential IP)**：利用用户本机的真实网络环境。由于 Twitter 无法封锁分散全球的真实家庭 IP，这彻底解决了 VPS 方案极易被 IP 封锁的痛点。
*   **三层连通架构 (Triple-Layer Connectivity)**：
    1.  **自发现层 (UPnP/NAT-PMP)**：本地矿机利用原生权限尝试开启路由端口映射，实现点对点直连。
    2.  **超级节点层 (P2P Relay)**：具备公网 IP 的节点被标记为“超级矿机”，负责为 NAT 后的节点提供中继流量，仅转发加密流而不参与解密。
    3.  **官方兜底层 (Official Fallback)**：作为全网第一个公证节点，官方服务器为系统提供冷启动支持与最后的连通保障。

### 2.3 UX 革命：异步见证 (ATA Flow / Scheme B)
通过解耦“用户行为”与“证据生成”来消除延迟：
1.  **捕获 (Capture)**：用户点击 Follow，插件瞬间记录相关 Headers Snapshots。
2.  **乐观通知 (Optimistic UI)**：前端提示用户“任务提交，正在生成资产收据”，不影响用户继续操作。
3.  **后台执行 (Background Attestation)**： Miner App 在后台与 Notary 节点异步完成 MPC 握手、直连直发、抄送密文等重型流程。
3.  **由于采用了异步抄送密文模型**，用户请求 Twitter 是直连的，延迟（RTT）与普通浏览器请求完全一致。

### 2.4 动态偏移量适配与上下文窗口验证 (Dynamic Offset & Context Window)
针对 Web2 接口（如 GraphQL）返回 JSON 结构不固定、Offset 随机化的问题，系统引入了自适应验证机制：
*   **上下文特征匹配 (Pattern Matching)**：Notary 不再信任绝对偏移量，而是解开包含目标字段及其“词法邻居”（如 `"followed_by":` , `"is_blue_verified":` 等 Key 值）的一个 **上下文滑动窗口 (Sliding Window)**。
*   **语义完整性校验**：通过解密窗口内的词法结构，Notary 可以确信提取的 Value 确实属于目标字段，而非 Prover 拼凑的虚假片段。这种“找邻居”的策略使系统对 API 结构的动态变化具备了极强的鲁棒性。

### 2.5 灵活清算与多路径结转 (Flexible Settlement & Multi-path Payout)
见证生成的 Proof 作为一份“通用收据”，支持多种清算模式，实现“证明即触发”：
1.  **收据标准化 (Universal Receipt)**：Notary 签发符合 **EIP-712** 的结构化证明。该证明包含行为指纹与数字签名，可被智能合约、后端服务器或第三方审计直接解析。
2.  **多路径验证与奖励分发**：
    *   **链上直验模式**：证明提交至智能合约，合约通过内置的 Notary 公钥列表验证签名合法性，原子化地从托管金中释放奖励。
    *   **广告主服务器模式 (Callback & Off-chain Auth)**：证明通过 **Webhook Callback** 实时发送给广告主服务器。广告主在验证证明后，可选择手动确认。
    *   **自动化结转与 x402 集成**：广告主或协议托管方在验证证明后，作为 **Facilitator** 角色主动调用 **x402 协议**。由托管方签名并赞助 Gas，发起交易将奖励精准发送至用户钱包。由于托管方拥有私钥并负责结算，这种模式完美解决了合约无法自发调用签名协议的问题。
3.  **透明度与可审计性**：生成的证明不仅作为发放奖励的凭证，还可供广告主在后台实时查看与审计，确保每一分投放都有据可查，彻底消除了社交广告中的虚假流量问题。

### 2.6 通信安全与跨进程凭证注入 (Native Messaging & Secure Injection)
为了解决浏览器扩展无法直接操作 TCP 协议且 Cookie 受限的问题，系统采用了 Native Messaging 安全总线：
1. **取消本地端口 (No Port Logic)**：弃用不安全的本地 WebSocket (避免端口劫持)，采用 Chrome 原生消息管道，通过进程间标准流进行双向通信。这确保了 Miner App 仅能由 TweetyCat 插件调起和交互。
2. **特权提取与注入 (Privileged Injection)**：利用插件 Service Worker 的特权环境，在用户触发行为时，毫秒级提取 `HttpOnly` 属性的 `auth_token` 与 `ct0` 凭证，并通过安全总线注入本地 Miner App 的加密引擎。
3. **环境分离 (Environment Decoupling)**：Miner App 接收凭证后，在原生 Native 环境中完成 TLS 1.3 报文的封装与发射。这种架构成功绕过了 Web 端对跨域和底层协议的限制，同时为敏感数据建立了一道物理隔离墙，极大提升了系统的安全性与生存能力。

---

## 3. 终极进化：P2P 协同公证与“极简选择性解密”

我们不仅去中心化了 Prover，还要去中心化 Notary：
1.  **我为人人 (Relay Mining)**：每个安装了“社交挖矿机”的用户，在闲置时都可以充当他人请求的“公证节点”。作为回报，公证节点在每笔验证金中抽取 **“中继算力费用”**。
2.  **无需电路的选择性解密 (Selective Disclosure via CTR Masking)**：
    *   **原理**：TLS 1.3 的 AES-GCM 采用计数器模式（CTR）。Notary 验证完整密文的 MAC 后，Prover 仅揭露包含关键数据（如 `is_blue_verified`）的特定 Offset 计数器块。
    *   **盲态验证**：Notary 协助解密该特定片段，验证其 JSON 路径与值是否符合预期模板，而对于 JSON 中包含的其余敏感信息（如私聊内容、Cookie 详情），Notary 因无对应计数器块的参与而完全处于“盲态”。
    *   **高效率**：这种基于流式加密特性的局部揭露，相比生成庞大的 ZK Proof，执行效率提升了 100 倍以上。
3.  **抗审查性**：公证节点不再是固定的几台服务器（避免了像 Reclaim 等商业 SDK 的中心化黑盒风险），而是分布在全球的终端。没有任何机构能通过封锁特定节点来使系统瘫痪。
4.  **语义完整性证明 (Semantic Integrity Proof)**：
    *   **核心论证**：由于 TLS 1.3 的 MAC (GCM Tag) 是对整个加密流的承诺。在 2-of-2 MPC 架构下，Prover 无法自主生成合法的 Tag。
    *   **抗伪造性**：当 Notary 解开包含特定“词法邻居”（如字段名）的上下文窗口时，这种特定的字节组合在密文流中的出现，在概率上必然意味着该片段与前后的 Session 状态是原子绑定的。攻击者无法在不掌握 Notary 所持分片的情况下，通过“剪切-粘贴”或其他方式在加密流中植入带有正确语义特征的虚假块。
5.  **公证人准入与抗合谋机制 (Notary Admission & Anti-Collusion)**：
    *   **节点注册 (Node Registry)**：只有在信令中心注册并公示公钥的节点才具备签名权限。合约内置白名单或质押机制，仅受信任的或有资产抵押的节点生成的签名才会被视为有效。
    *   **随机指派 (Random Assignment)**：Prover 无法自主选择公证者。系统通过信令层进行随机撮合，切断证明者与公证者之间的合谋链路。
    *   **经济约束 (Economic Security)**：引入质押与罚没机制（Staking & Slashing）。公证节点若被审计发现签发伪造证据，将面临经济损失与永久禁抵，确保系统在博弈论层面保持诚实。
6.  **生态演进：从中心化控制到 DAO 治理 (Governance Evolution)**：
    *   **治理权下放**：公证节点的名录、准入标准以及信誉评分从中心化服务器迁移至链上 **DAO 合约**。
    *   **第三方服务准入 (Permissionless Services)**：任何第三方机构若希望建立自己的见证服务，均可根据 DAO 合约中的授信列表，自由筛选其信任的公证节点集合并进行“二次背书（Service-level Signing）”。
    *   **社区自治与生态承载**：系统的“信任锚点”最终由 DAO 管理。这种架构实现了我们的服务器从“管理者”向“参与者”的身份转换，极大地释放了服务器负载，并将 TweetyCat 进化为一个去中心化的、由社区共建共管的社交事实预言机协议。

---

## 4. 论文框架与“异构价值桥接” (Academic Contributions)

### 4.1 论文核心架构
*   **Introduction**: 解决 Web2 数据资产化过程中的 **“最后 100 米”预言机难题**。
*   **The ATA Protocol**: 提出一种异步、无预言机的见证规约，及基于 **MAC 对称性破缺** 的安全性证明。
*   **Social Miner Architecture**: 论证本地原生环境与浏览器上下文结合产生的 **“隐私沙盒隔离”** 效应。
*   **Activity-Triggered Payment (ATP)**：定义一种全新的交互范式——基于社交行为直接触发链上支付的自动化金融。

### 4.2 论文关键创新点 (Paper Shiny Points)
1.  **Oracle-less Verification**: 开创了无需第三方信任中介的社交行为审计范式，将 Trust Anchor（信任锚点）从组织迁移到了加密协议本身。
2.  **Asynchronous Integrity (异步完整性)**：通过“证据快照+后台 MPC”的组合，解决了高安全性需求与 Web 应用高时效需求之间的物理矛盾。
3.  **Cross-Domain Value Bridge (异构价值桥梁)**：系统性地展示了如何将 HTTP 协议层面的信息流（Information）直接泵入以太坊/Base 链的价值流（Value），实现 Web2 与 Web3 的无缝结算。
4.  **Decentralized Trust Management (去中心化信任治理模型)**：论证了如何通过 DAO 合约管理分布式公证节点名录，实现了信任锚点从单一实体向社区共识的动态、平滑且抗审查的迁移。
5.  **High-Efficiency Selective Disclosure (高效选择性披露机制)**：提出了基于流式加密计数器掩码（CTR Masking）的局部解密方案，避免了传统 ZK 方案中庞大的算术电路开销，实现了受限终端环境下的极速、低能耗见证。

---

## 5. 社交挖矿：Web3 时代的价值重定义
*   **算力即行为**：用户的真实社交行为（关注、转发、点赞）经过 ATA 加密证明后，被赋予了资产属性。
*   **矿机即入口**：本地 Miner App 是用户的个人数据网关，协助用户将分散在 Web2 平台中的影响力（Social Influence）实时“开采”并转化为链上资本（On-chain Capital）。

---

本方案通过 **密码学（MPC）+ 系统工程（Native App）+ 经济学（P2P Incentive）** 的三合一，实现了一套足以改变 Web3 用户获取数据规则的基础底层。它让 TweetyCat 不再仅仅是一个广告工具，而是一个全球分布式的、防审查的、隐私安全的社交事实数据预言机。

---

## 附录：开发与工程实现备注 (Implementation Notes)

### 1. “锚点 API” (Anchor API) 策略
*   **现状**：遍历大规模粉丝列表获取关注关系既耗能又不稳定，且 JSON 结构过于庞大。
*   **优化**：在实际落地中，通过调用针对特定用户的“锚点 API”（如 `UserByScreenName` 或 `UserByRestId`），Twitter 会在返回的 `legacy` 或 `relationship` 字段中直接包含 `"followed_by": true`。
*   **意义**：这极大地收窄了待证明的数据量，提高了 MPC 握手后的解密效率，是首选的工程实践路径。在遇到结构更复杂的个性化 JSON 时，再自动切换到 2.4 描述的动态路径见证模式。
