//
//  SystemProxySettings.swift
//  TweetCatApp
//
//  Created by wesley on 2025/9/10.
//

import Foundation

public struct SystemProxySettings: Equatable {
    public var httpHost: String?
    public var httpPort: Int?
    public var httpsHost: String?
    public var httpsPort: Int?
    public var socksHost: String?
    public var socksPort: Int?
    public var pacURL: String?

    public var hasAnyProxy: Bool {
        return httpHost != nil || httpsHost != nil || socksHost != nil
            || pacURL != nil
    }
}

public struct NetworkStatus: Equatable {
    public var hasUtunInterface: Bool  // 是否发现 utun* 虚拟网卡
    public var defaultRouteViaUtun: Bool  // 默认路由是否走 utun（强烈暗示 VPN）
    public var systemProxy: SystemProxySettings
    public var outboundIPSample: String?  // 可选：出口 IP（可能为空）
    public var note: String  // 供 UI 显示的简短说明

    public var isLikelyVPNOrProxyAvailable: Bool {
        defaultRouteViaUtun || systemProxy.hasAnyProxy
    }
}

public enum ProxyModeChoice: String {
    case auto  // 优先使用系统代理/自动探测
    case manual  // 使用手动配置（来自设置页）
    case off  // 不使用代理
}

/// 最终给 yt-dlp 的代理配置
public struct YTDLPProxyConfig: Equatable {
    /// yt-dlp 的 `--proxy` 参数值，例如 "http://127.0.0.1:7890"、"socks5://127.0.0.1:1080"
    public var cliProxyURL: String?
    /// 可选：为子进程设置的环境变量（http_proxy/https_proxy/all_proxy 等）
    public var env: [String: String] = [:]
}


public func prepareProxy(manual: ManualProxyForm = ManualProxyForm()) async
    -> String?
{
    let inspector = NetworkInspector()
    let status = await inspector.detect()
    print("[Network] 检测结果: \(status.note)")

    let proxyConfig = ProxyApplier.makeYTDLPProxyConfig(
        network: status,
        manual: manual
    )
    let cli = proxyConfig.cliProxyURL
    if let cli, !cli.isEmpty {
        print("[Network] 使用代理: \(cli)  env=\(proxyConfig.env)")
        return cli
    } else {
        print("[Network] 未使用代理（直连）")
        return nil
    }
}
