//
//  ManualProxyForm.swift
//  TweetCatApp
//
//  Created by wesley on 2025/9/10.
//

import Foundation

public struct ManualProxyForm {
    public var mode: ProxyModeChoice = .auto  // auto/manual/off
    // manual 模式下可选字段：
    public var httpHost: String?
    public var httpPort: Int?
    public var httpsHost: String?
    public var httpsPort: Int?
    public var socksHost: String?
    public var socksPort: Int?
    public var socksV5: Bool = true
    public var pacURL: String?

    public init() {}
}

public enum ProxyApplier {
    /// 从“自动检测结果 + 手动表单选择”合成供 yt-dlp 使用的代理配置
    public static func makeYTDLPProxyConfig(
        network: NetworkStatus,
        manual: ManualProxyForm
    ) -> YTDLPProxyConfig {
        switch manual.mode {
        case .off:
            return YTDLPProxyConfig(cliProxyURL: nil, env: [:])
        case .manual:
            // 优先 SOCKS，其次 HTTP/HTTPS（按你的偏好可调整）
            if let sHost = manual.socksHost, let sPort = manual.socksPort,
                sPort > 0
            {
                let scheme = manual.socksV5 ? "socks5" : "socks4"
                return YTDLPProxyConfig(
                    cliProxyURL: "\(scheme)://\(sHost):\(sPort)",
                    env: ["ALL_PROXY": "\(scheme)://\(sHost):\(sPort)"]
                )
            } else if let hHost = manual.httpHost, let hPort = manual.httpPort,
                hPort > 0
            {
                return YTDLPProxyConfig(
                    cliProxyURL: "http://\(hHost):\(hPort)",
                    env: [
                        "http_proxy": "http://\(hHost):\(hPort)",
                        "https_proxy": "http://\(hHost):\(hPort)",
                    ]

                )
            } else if let hh = manual.httpsHost, let hp = manual.httpsPort,
                hp > 0
            {
                return YTDLPProxyConfig(
                    cliProxyURL: "http://\(hh):\(hp)",
                    env: ["https_proxy": "http://\(hh):\(hp)"]
                )
            } else if let pac = manual.pacURL, !pac.isEmpty {
                // yt-dlp 不直接支持 PAC URL；通常需要系统层解析。
                // 这里给出明确提示：建议在设置页提示“PAC 需通过系统代理生效”。
                return YTDLPProxyConfig(cliProxyURL: nil, env: [:])
            } else {
                return YTDLPProxyConfig(cliProxyURL: nil, env: [:])
            }
        case .auto:
            // 优先系统 SOCKS，其次系统 HTTP/HTTPS
            if let sHost = network.systemProxy.socksHost,
                let sPort = network.systemProxy.socksPort, sPort > 0
            {
                return YTDLPProxyConfig(
                    cliProxyURL: "socks5://\(sHost):\(sPort)",
                    env: ["ALL_PROXY": "socks5://\(sHost):\(sPort)"]
                )
            } else if let hHost = network.systemProxy.httpHost,
                let hPort = network.systemProxy.httpPort, hPort > 0
            {
                // 即使 HTTPS 也可通过 http 代理转发
                return YTDLPProxyConfig(
                    cliProxyURL: "http://\(hHost):\(hPort)",
                    env: [
                        "http_proxy": "http://\(hHost):\(hPort)",
                        "https_proxy": "http://\(hHost):\(hPort)",
                    ]
                )
            } else if let hh = network.systemProxy.httpsHost,
                let hp = network.systemProxy.httpsPort, hp > 0
            {
                return YTDLPProxyConfig(
                    cliProxyURL: "http://\(hh):\(hp)",
                    env: ["https_proxy": "http://\(hh):\(hp)"]
                )
            } else {
                // 没有系统代理：如果默认路由走 utun，我们仍可尝试直连（VPN 场景）
                return YTDLPProxyConfig(cliProxyURL: nil, env: [:])
            }
        }
    }
}
