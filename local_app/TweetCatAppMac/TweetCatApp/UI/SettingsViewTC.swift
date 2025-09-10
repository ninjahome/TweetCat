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

    @StateObject private var netVM = NetworkInspectorViewModel()

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
        }.task {
            if netVM.status == nil { netVM.refresh() }
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
                    // 真实检测结果
                    VStack(alignment: .leading, spacing: 6) {
                        if netVM.loading {
                            ProgressView("检测中…")
                        } else if let s = netVM.status {
                            Label(
                                s.hasUtunInterface
                                    ? "发现 utun 接口" : "未发现 utun 接口",
                                systemImage: s.hasUtunInterface
                                    ? "checkmark.circle" : "xmark.circle"
                            )
                            Label(
                                s.defaultRouteViaUtun
                                    ? "默认路由可能经过 VPN" : "默认路由未经过 VPN",
                                systemImage: s.defaultRouteViaUtun
                                    ? "checkmark.circle" : "xmark.circle"
                            )
                            if let httpHost = s.systemProxy.httpHost,
                                let httpPort = s.systemProxy.httpPort
                            {
                                Label(
                                    "系统 HTTP 代理：\(httpHost):\(httpPort)",
                                    systemImage: "network"
                                )
                            }
                            if let socksHost = s.systemProxy.socksHost,
                                let socksPort = s.systemProxy.socksPort
                            {
                                Label(
                                    "系统 SOCKS 代理：\(socksHost):\(String(socksPort))",
                                    systemImage: "network"
                                )
                            }
                            if let pac = s.systemProxy.pacURL, !pac.isEmpty {
                                Label("PAC URL：\(pac)", systemImage: "link")
                            }
                            if let ip = s.outboundIPSample {
                                Label("出口 IP：\(ip)", systemImage: "globe")
                            }
                            Text(s.note)
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        } else {
                            Text("尚未获得检测结果").foregroundStyle(.secondary)
                        }
                    }
                    .padding(.leading, 2)

                    HStack {
                        Button("重新检测") { netVM.refresh() }
                            .buttonStyle(.bordered).disabled(netVM.loading)
                        // 可选：预览将传给 yt-dlp 的 --proxy
                        if let s = netVM.status {
                            let applied = ProxyApplier.makeYTDLPProxyConfig(
                                network: s,
                                manual: ManualProxyForm()  // auto 模式下传默认表单即可
                            )
                            if let url = applied.cliProxyURL, !url.isEmpty {
                                Text("将应用到 yt-dlp 的代理：\(url)")
                                    .font(
                                        .system(.caption, design: .monospaced)
                                    )
                                    .foregroundStyle(.secondary)
                            } else if s.isLikelyVPNOrProxyAvailable {
                                Text("预计走 VPN（无显式代理），将不设置 --proxy")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            } else {
                                Text("未检测到代理/VPN，yt-dlp 可能无法访问外网")
                                    .font(.caption)
                                    .foregroundStyle(.red)
                            }
                        }
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

            // 只读预览：手动模式下将应用到 yt-dlp 的 --proxy
            if manualMode == .manual || manualMode == .useSystem
                || manualMode == .autoDetect
            {
                Divider().padding(.vertical, 4)
                Text("将应用到 yt-dlp 的代理：\(previewProxy())")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    // 在 SettingsViewTC 里加：
    private func buildManualForm() -> ManualProxyForm {
        var f = ManualProxyForm()
        switch manualMode {
        case .manual:
            f.mode = .manual
            if !socksHost.isEmpty, socksPort > 0 {
                f.socksHost = socksHost
                f.socksPort = socksPort
                f.socksV5 = socksV5
            } else if !httpHost.isEmpty, httpPort > 0 {
                f.httpHost = httpHost
                f.httpPort = httpPort
                if !alsoUseForHTTPS {
                    if !httpsHost.isEmpty, httpsPort > 0 {
                        f.httpsHost = httpsHost
                        f.httpsPort = httpsPort
                    }
                }
            }
            if !pacURL.isEmpty { f.pacURL = pacURL }
        case .useSystem:
            f.mode = .auto  // “跟随系统代理”本质等价 auto
        case .autoDetect:
            f.mode = .auto
        case .none, .pac:
            break
        }
        return f
    }

    private func previewProxy() -> String {
        guard let s = netVM.status else { return "(等待网络检测结果)" }
        let applied = ProxyApplier.makeYTDLPProxyConfig(
            network: s,
            manual: buildManualForm()
        )
        return applied.cliProxyURL ?? "(无 --proxy，走直连/系统层 VPN)"
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
