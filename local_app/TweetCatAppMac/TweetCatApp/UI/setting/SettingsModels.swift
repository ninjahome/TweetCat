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

struct SettingsManager {
    static let shared = SettingsManager()
    private init() {}

    /// 清理 .part 临时文件
    func clearTempFiles(in root: String) {
        let expandedRoot = (root as NSString).expandingTildeInPath
        let shorts = URL(fileURLWithPath: expandedRoot).appendingPathComponent(
            "shorts"
        )
        let watch = URL(fileURLWithPath: expandedRoot).appendingPathComponent(
            "watch"
        )

        let fm = FileManager.default
        let candidates = [shorts, watch]
        let now = Date()

        // 正则：匹配包含 .part 的文件
        let regex = try! NSRegularExpression(
            pattern: #"\.part(\.|$)"#,
            options: .caseInsensitive
        )

        for dir in candidates {
            print("🔍 检查目录: \(dir.path)")

            var isDir: ObjCBool = false
            if !fm.fileExists(atPath: dir.path, isDirectory: &isDir)
                || !isDir.boolValue
            {
                print("⚠️ 目录不存在或不是文件夹: \(dir.path)")
                continue
            }

            do {
                let files = try fm.contentsOfDirectory(
                    at: dir,
                    includingPropertiesForKeys: [.contentModificationDateKey]
                )
                print("📂 目录 \(dir.lastPathComponent) 中找到 \(files.count) 个文件")

                for file in files {
                    print("➡️ 发现文件: \(file.lastPathComponent)")

                    let name = file.lastPathComponent
                    let range = NSRange(location: 0, length: name.utf16.count)
                    if regex.firstMatch(in: name, options: [], range: range)
                        != nil
                    {
                        print("🎯 命中临时文件: \(name)")

                        do {
                            // 最近修改时间检查（避免删除活跃文件）
                            let attrs = try fm.attributesOfItem(
                                atPath: file.path
                            )
                            if let modDate = attrs[.modificationDate] as? Date {
                                let interval = now.timeIntervalSince(modDate)
                                if interval < 10 {
                                    print(
                                        "⏸ 跳过活跃文件: \(name) (最近修改: \(Int(interval)) 秒前)"
                                    )
                                    continue
                                }
                            }

                            try fm.removeItem(at: file)

                            if fm.fileExists(atPath: file.path) {
                                print("⚠️ 删除尝试后文件仍存在: \(name)")
                            } else {
                                print("🗑 已删除临时文件: \(name)")
                            }
                        } catch {
                            print(
                                "❌ 删除失败: \(name) - \(error.localizedDescription)"
                            )
                        }
                    }
                }
            } catch {
                print("❌ 无法读取目录 \(dir.path): \(error.localizedDescription)")
            }
        }
    }
}
