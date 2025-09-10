//
//  SettingsViewTC.swift
//  TweetCatApp
//
//  Created by wesley on 2025/9/10.
//
import SwiftUI

struct SettingsViewTC: View {
    // 假数据：先放到 AppStorage，方便你重启后保持
    @AppStorage("downloadRoot") private var downloadRoot: String =
        "~/Downloads/TweetCat"
    @AppStorage("autoCreateSubdirs") private var autoCreateSubdirs: Bool =
        true
    @AppStorage("shortsThreshold") private var shortsThreshold: Int = 60
    @AppStorage("concurrency") private var concurrency: Int = 1
    @AppStorage("conflictPolicy") private var conflictPolicyRaw: String =
        ConflictPolicy.rename.rawValue

    @AppStorage("useAutoDetectNetwork") private var useAutoDetectNetwork: Bool =
        true
    @AppStorage("manualProxyMode") private var manualProxyModeRaw: String =
        ProxyMode.autoDetect.rawValue

    // 手动代理字段（仅 UI 存储，后续接入真实逻辑再统一落地）
    @AppStorage("httpHost") private var httpHost: String = "127.0.0.1"
    @AppStorage("httpPort") private var httpPort: Int = 31080
    @AppStorage("alsoHTTPS") private var alsoUseForHTTPS: Bool = true
    @AppStorage("httpsHost") private var httpsHost: String = "127.0.0.1"
    @AppStorage("httpsPort") private var httpsPort: Int = 31080
    @AppStorage("socksHost") private var socksHost: String = ""
    @AppStorage("socksPort") private var socksPort: Int = 0
    @AppStorage("socksV5") private var socksV5: Bool = true
    @AppStorage("pacURL") private var pacURL: String = ""
    @AppStorage("noProxyFor") private var noProxyFor: String =
        ".mozilla.org, .net.nz, 192.168.1.0/24"

    // 通知
    @AppStorage("notifyDone") private var notifyDone: Bool = true
    @AppStorage("notifyFail") private var notifyFail: Bool = true

    // 模拟检测结果（假数据）
    @State private var detected = DetectedNetworkState()

    private var conflict: ConflictPolicy {
        get { ConflictPolicy(rawValue: conflictPolicyRaw) ?? .rename }
        set { conflictPolicyRaw = newValue.rawValue }
    }
    private var manualMode: ProxyMode {
        get { ProxyMode(rawValue: manualProxyModeRaw) ?? .autoDetect }
        set { manualProxyModeRaw = newValue.rawValue }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                downloadSection
                networkSection
                notificationSection
                integrationSection
            }
            .padding()
        }
        .navigationTitle("设置")
        .toolbar {
            ToolbarItem(placement: .principal) {
                Text("设置").font(.title3)
            }
        }
    }

    // MARK: 下载
    private var downloadSection: some View {
        GroupBox("下载") {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text("根目录")
                    Spacer()
                    Text(downloadRoot).foregroundStyle(
                        .secondary
                    )
                }
                Toggle(
                    "自动创建 Watch/Shorts 子目录",
                    isOn: $autoCreateSubdirs
                )
                Stepper(
                    "Shorts 阈值（秒）：\(shortsThreshold)",
                    value: $shortsThreshold,
                    in: 5...180
                )
                Stepper(
                    "并发下载数：\(concurrency)",
                    value: $concurrency,
                    in: 1...3
                )
                Picker(
                    "冲突策略",
                    selection: Binding<ConflictPolicy>(
                        get: {
                            ConflictPolicy(
                                rawValue:
                                    conflictPolicyRaw
                            ) ?? .rename
                        },
                        set: {
                            conflictPolicyRaw =
                                $0.rawValue
                        }  // ⬅️ 直接写底层存储
                    )
                ) {
                    ForEach(ConflictPolicy.allCases) { c in
                        Text(c.rawValue).tag(c)
                    }
                }
                .frame(width: 260)
            }
            .padding(8)
        }
    }

    // MARK: 网络（自动检测 / 手动配置）
    private var networkSection: some View {
        GroupBox("网络 / 代理 / VPN") {
            VStack(alignment: .leading, spacing: 12) {
                Toggle(
                    "自动检测网络（优先使用系统代理 / 检测 utun / 观察默认路由）",
                    isOn: $useAutoDetectNetwork
                )

                if useAutoDetectNetwork {
                    // 只读展示（假数据）
                    VStack(alignment: .leading, spacing: 6) {
                        Label(
                            detected.hasUtun
                                ? "发现 utun 接口"
                                : "未发现 utun 接口",
                            systemImage: detected
                                .hasUtun
                                ? "checkmark.circle"
                                : "xmark.circle"
                        )
                        Label(
                            detected
                                .defaultRouteViaVPN
                                ? "默认路由可能经过 VPN"
                                : "默认路由未经过 VPN",
                            systemImage: detected
                                .defaultRouteViaVPN
                                ? "checkmark.circle"
                                : "xmark.circle"
                        )
                        if let http = detected
                            .systemHTTPProxy
                        {
                            Label(
                                "系统 HTTP 代理：\(http)",
                                systemImage:
                                    "network"
                            )
                        }
                        if let socks = detected
                            .systemSOCKSProxy
                        {
                            Label(
                                "系统 SOCKS 代理：\(socks)",
                                systemImage:
                                    "network"
                            )
                        }
                        if let pac = detected.pacURL {
                            Label(
                                "PAC URL：\(pac)",
                                systemImage:
                                    "link"
                            )
                        }
                        if let ip = detected.outboundIP {
                            Label(
                                "出口 IP（示例）：\(ip)",
                                systemImage:
                                    "globe"
                            )
                        }
                        Text(detected.note).font(
                            .footnote
                        ).foregroundStyle(.secondary)
                    }
                    .padding(.leading, 2)

                    HStack {
                        Button("重新检测（假）") {
                            // 假动作：随机切换一两项，模拟“重新检测”
                            detected.hasUtun
                                .toggle()
                            detected
                                .defaultRouteViaVPN =
                                detected.hasUtun
                        }
                        .buttonStyle(.bordered)
                        Spacer()
                    }
                } else {
                    manualProxyForm
                }
            }
            .padding(8)
        }
    }

    // 手动表单（参考你的截图）
    private var manualProxyForm: some View {
        VStack(alignment: .leading, spacing: 10) {
            Picker(
                "代理模式",
                selection: Binding<ProxyMode>(
                    get: {
                        ProxyMode(
                            rawValue:
                                manualProxyModeRaw
                        ) ?? .autoDetect
                    },
                    set: {
                        manualProxyModeRaw = $0.rawValue
                    }
                )
            ) {
                Text("No proxy").tag(ProxyMode.none)
                Text(
                    "Auto-detect proxy settings for this network"
                ).tag(ProxyMode.autoDetect)
                Text("Use system proxy settings").tag(
                    ProxyMode.useSystem
                )
                Text("Manual proxy configuration").tag(
                    ProxyMode.manual
                )
                Text("Automatic proxy configuration URL").tag(
                    ProxyMode.pac
                )
            }
            .pickerStyle(.radioGroup)
            .frame(maxWidth: 560, alignment: .leading)

            if manualMode == .manual {
                Grid(
                    alignment: .leading,
                    horizontalSpacing: 12,
                    verticalSpacing: 8
                ) {
                    GridRow {
                        Text("HTTP Proxy")
                        TextField(
                            "host",
                            text: $httpHost
                        ).frame(width: 200)
                        Text("Port")
                        TextField(
                            "port",
                            value: $httpPort,
                            formatter:
                                NumberFormatter()
                        ).frame(width: 80)
                    }
                    GridRow {
                        Toggle(
                            "Also use this proxy for HTTPS",
                            isOn: $alsoUseForHTTPS
                        )
                        .gridCellColumns(4)
                    }
                    GridRow {
                        Text("HTTPS Proxy")
                        TextField(
                            "host",
                            text: $httpsHost
                        ).frame(width: 200).disabled(
                            alsoUseForHTTPS
                        )
                        Text("Port")
                        TextField(
                            "port",
                            value: $httpsPort,
                            formatter:
                                NumberFormatter()
                        ).frame(width: 80).disabled(
                            alsoUseForHTTPS
                        )
                    }
                    GridRow {
                        Text("SOCKS Host")
                        TextField(
                            "socks5://host or 127.0.0.1",
                            text: $socksHost
                        ).frame(width: 200)
                        Text("Port")
                        TextField(
                            "port",
                            value: $socksPort,
                            formatter:
                                NumberFormatter()
                        ).frame(width: 80)
                    }
                    GridRow {
                        Text("SOCKS v4 / v5")
                        HStack {
                            Toggle(
                                "SOCKS v5",
                                isOn: $socksV5
                            )
                        }
                        .gridCellColumns(3)
                    }
                }
            } else if manualMode == .pac {
                VStack(alignment: .leading, spacing: 8) {
                    Text(
                        "Automatic proxy configuration URL"
                    )
                    TextField(
                        "http(s)://example.com/proxy.pac",
                        text: $pacURL
                    )
                    .textFieldStyle(.roundedBorder)
                    .frame(width: 420)
                    HStack {
                        Button("Reload") { /* 假动作 */  }
                        Spacer()
                    }
                }
            }

            // 统一的 "No proxy for" 与选项
            VStack(alignment: .leading, spacing: 8) {
                Text("No proxy for")
                TextField(
                    ".mozilla.org, .net.nz, 192.168.1.0/24",
                    text: $noProxyFor
                )
                .textFieldStyle(.roundedBorder)
                .frame(width: 520)
                Toggle(
                    "Do not prompt for authentication if password is saved",
                    isOn: .constant(true)
                )
                Toggle(
                    "Proxy DNS when using SOCKS v4",
                    isOn: .constant(false)
                )
            }
            .padding(.top, 6)
        }
    }

    // MARK: 通知
    private var notificationSection: some View {
        GroupBox("通知") {
            VStack(alignment: .leading, spacing: 8) {
                Toggle("下载完成时通知", isOn: $notifyDone)
                Toggle("下载失败时通知", isOn: $notifyFail)
            }
            .padding(8)
        }
    }

    // MARK: 集成状态（只读）
    private var integrationSection: some View {
        GroupBox("集成状态（只读）") {
            VStack(alignment: .leading, spacing: 8) {
                Label(
                    "浏览器扩展：等待消息…（假）",
                    systemImage: "puzzlepiece.extension"
                )
                Label(
                    "yt-dlp：\( "v2025.00 (mock)" )",
                    systemImage: "wrench.and.screwdriver"
                )
                Label(
                    "Manifest：已安装（假）",
                    systemImage: "checkmark.seal"
                )
            }
            .padding(8)
        }
    }
}
