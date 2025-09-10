//
//  NetworkInspector.swift
//  TweetCatApp
//
//  Created by wesley on 2025/9/10.
//

import Foundation
import SystemConfiguration

public final class NetworkInspector {

    public init() {}

    // 入口：一次性做多项检测
    public func detect() async -> NetworkStatus {
        async let sysProxy = readSystemProxy()
        async let hasUtun = detectUtunInterface()
        async let viaUtun = detectDefaultRouteViaUtun()
        async let ip = sampleOutboundIP()  // 可选，失败返回 nil

        let (proxy, utun, defaultViaUtun, outbound) = await (
            sysProxy, hasUtun, viaUtun, ip
        )

        var noteParts: [String] = []
        if utun { noteParts.append("检测到 utun") }
        noteParts.append(defaultViaUtun ? "默认路由经由 utun（疑似 VPN）" : "默认路由不经 utun")
        if proxy.hasAnyProxy { noteParts.append("发现系统代理设置") }
        let note = noteParts.joined(separator: " · ")

        return NetworkStatus(
            hasUtunInterface: utun,
            defaultRouteViaUtun: defaultViaUtun,
            systemProxy: proxy,
            outboundIPSample: outbound,
            note: note.isEmpty ? "未检测到代理/VPN 特征" : note
        )
    }

    // MARK: - System Proxy via CFNetwork (无需外部命令)
    public func readSystemProxy() async -> SystemProxySettings {
        await withCheckedContinuation { cont in
            DispatchQueue.global(qos: .utility).async {
                var result = SystemProxySettings()
                if let dict = CFNetworkCopySystemProxySettings()?
                    .takeRetainedValue() as? [String: Any]
                {
                    // HTTP
                    if let enabled = dict[kCFNetworkProxiesHTTPEnable as String]
                        as? NSNumber, enabled.boolValue
                    {
                        if let host = dict[kCFNetworkProxiesHTTPProxy as String]
                            as? String
                        {
                            result.httpHost = host
                        }
                        if let port = dict[kCFNetworkProxiesHTTPPort as String]
                            as? NSNumber
                        {
                            result.httpPort = port.intValue
                        }
                    }
                    // HTTPS
                    if let enabled = dict[
                        kCFNetworkProxiesHTTPSEnable as String
                    ] as? NSNumber, enabled.boolValue {
                        if let host = dict[
                            kCFNetworkProxiesHTTPSProxy as String
                        ] as? String {
                            result.httpsHost = host
                        }
                        if let port = dict[kCFNetworkProxiesHTTPSPort as String]
                            as? NSNumber
                        {
                            result.httpsPort = port.intValue
                        }
                    }
                    // SOCKS
                    if let enabled = dict[
                        kCFNetworkProxiesSOCKSEnable as String
                    ] as? NSNumber, enabled.boolValue {
                        if let host = dict[
                            kCFNetworkProxiesSOCKSProxy as String
                        ] as? String {
                            result.socksHost = host
                        }
                        if let port = dict[kCFNetworkProxiesSOCKSPort as String]
                            as? NSNumber
                        {
                            result.socksPort = port.intValue
                        }
                    }
                    // PAC
                    if let pacEnabled = dict[
                        kCFNetworkProxiesProxyAutoConfigEnable as String
                    ] as? NSNumber,
                        pacEnabled.boolValue,
                        let url = dict[
                            kCFNetworkProxiesProxyAutoConfigURLString as String
                        ] as? String,
                        !url.isEmpty
                    {
                        result.pacURL = url
                    }
                }
                cont.resume(returning: result)
            }
        }
    }

    // 是否存在 utun 接口
    public func detectUtunInterface() async -> Bool {
        // /sbin/ifconfig | grep utun
        if let (_, out, _) = await Subprocess.runOutput("/sbin/ifconfig", []) {
            return out.contains("utun")
        }
        return false
    }

    // 默认路由是否走 utun
    public func detectDefaultRouteViaUtun() async -> Bool {
        // route -n get default
        if let (_, out, _) = await Subprocess.runOutput(
            "/usr/sbin/route",
            ["-n", "get", "default"]
        ) {
            for line in out.split(separator: "\n") {
                if line.lowercased().contains("interface:")
                    && line.lowercased().contains("utun")
                {
                    return true
                }
            }
        }
        return false
    }

    // MARK: - 可选：采样出口 IP（不要求，失败返回 nil）
    public func sampleOutboundIP() async -> String? {
        // 为避免依赖外网服务，这里默认返回 nil；如果你有内网 echo 服务，可在此实现
        return nil
    }
}

// MARK: - Subprocess 便捷封装（对齐你当前的 API）
extension Subprocess {
    /// 运行可执行文件并返回 (status, stdout, stderr)。失败返回 nil。
    static func runOutput(
        _ executablePath: String,
        _ arguments: [String],
        proxyEnv: [String: String]? = nil
    ) async -> (Int32, String, String)? {
        await withCheckedContinuation { cont in
            DispatchQueue.global(qos: .utility).async {
                do {
                    let url = URL(fileURLWithPath: executablePath)
                    let tuple = try Subprocess.run(
                        executableURL: url,
                        arguments: arguments,
                        proxyEnv: proxyEnv
                    )
                    cont.resume(returning: tuple)  // (status, out, err)
                } catch {
                    cont.resume(returning: nil)
                }
            }
        }
    }
}
