//
//  VPNProfile.swift
//  TweetCatApp
//
//  Created by wesley on 2025/9/10.
//

import Foundation

enum VPNProfile: String, CaseIterable, Identifiable {
    case off = "关闭"
    case vpn1 = "vpn1"
    case vpn2 = "vpn2"
    var id: String { rawValue }
}

enum ConflictPolicy: String, CaseIterable, Identifiable {
    case skip = "跳过"
    case overwrite = "覆盖"
    case rename = "自动重命名"
    var id: String { rawValue }
}

// 手动代理模式（参考你的截图）
enum ProxyMode: String, CaseIterable, Identifiable {
    case none = "No proxy"
    case autoDetect = "Auto-detect proxy settings"
    case useSystem = "Use system proxy settings"
    case manual = "Manual proxy configuration"
    case pac = "Automatic proxy configuration URL"
    var id: String { rawValue }
}

// 自动检测到的“只读”网络状态（假数据阶段）
struct DetectedNetworkState {
    var hasUtun: Bool = true
    var defaultRouteViaVPN: Bool = true
    var systemHTTPProxy: String? = "127.0.0.1:31080"
    var systemSOCKSProxy: String? = nil
    var pacURL: String? = nil
    var outboundIP: String? = "203.0.113.10"
    var note: String = "已检测到 utun2 且默认路由经过 VPN（示例）"
}

// 仅供 UI 存取（先用假数据）
struct SettingsPreview {
    var downloadRoot: String = "~/Downloads/TweetCat"
    var autoCreateSubdirs: Bool = true
    var shortsThreshold: Int = 60
    var concurrency: Int = 1
    var conflict: ConflictPolicy = .rename
    var notifyOnDone: Bool = true
    var notifyOnFail: Bool = true

    // 网络
    var useAutoDetectNetwork: Bool = true
    var detected: DetectedNetworkState = DetectedNetworkState()

    // 手动代理（仅当 useAutoDetectNetwork == false 时生效）
    var manualMode: ProxyMode = .autoDetect
    var httpHost: String = "127.0.0.1"
    var httpPort: Int = 31080
    var alsoUseForHTTPS: Bool = true
    var httpsHost: String = "127.0.0.1"
    var httpsPort: Int = 31080
    var socksHost: String = ""
    var socksPort: Int = 0
    var socksV5: Bool = true
    var pacConfigURL: String = ""
    var noProxyFor: String = ".mozilla.org, .net.nz, 192.168.1.0/24"

    // 集成状态（只读模拟）
    var extensionConnected: Bool = false
    var ytdlpVersion: String = "v2025.00 (mock)"
    var manifestOK: Bool = true
}
