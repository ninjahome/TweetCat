//
//  Manifest.swift
//  TweetCatApp
//
//  Created by wesley on 2025/9/5.
//


import Foundation

/// 你资源里的文件名（不含路径）
private let kManifestBaseName = "com.dessage.tweetCatApp"
private let kManifestExt = "json"

/// 目标：~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.dessage.tweetCatApp.json
private func chromeHostDir() -> URL {
    let home = FileManager.default.homeDirectoryForCurrentUser
    return home
        .appendingPathComponent("Library")
        .appendingPathComponent("Application Support")
        .appendingPathComponent("Google")
        .appendingPathComponent("Chrome")
        .appendingPathComponent("NativeMessagingHosts")
}

private func chromeManifestURL() -> URL {
    chromeHostDir().appendingPathComponent("\(kManifestBaseName).\(kManifestExt)")
}

private struct Manifest: Codable {
    var name: String
    var description: String?
    var path: String
    var type: String
    var allowed_origins: [String]
    /// 可选版本字段（你可以在资源里的 json 增加 "version": 2）
    var version: Int?
}

/// 读资源中的清单（Bundle.main/Resources）
private func loadBundledManifest() throws -> (data: Data, manifest: Manifest) {
    guard let url = Bundle.main.url(forResource: kManifestBaseName, withExtension: kManifestExt) else {
        throw NSError(domain: "ManifestInstaller", code: -1, userInfo: [NSLocalizedDescriptionKey: "Resource manifest not found"])
    }
    let data = try Data(contentsOf: url)
    let m = try JSONDecoder().decode(Manifest.self, from: data)
    return (data, m)
}

/// 读已安装的清单（如果存在）
private func loadInstalledManifest(at url: URL) throws -> Manifest {
    let data = try Data(contentsOf: url)
    return try JSONDecoder().decode(Manifest.self, from: data)
}

/// 原子写入（自动创建父目录）；失败时抛错
private func atomicWrite(_ data: Data, to url: URL) throws {
    let dir = url.deletingLastPathComponent()
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    // 使用 .atomic 确保写入完整性
    try data.write(to: url, options: [.atomic])
}

/// 版本比较逻辑：nil 视为 0
private func shouldOverwrite(installed: Manifest?, bundled: Manifest) -> Bool {
    let vInstalled = installed?.version ?? 0
    let vBundled = bundled.version ?? 0
    // 仅当资源里的版本更高时覆盖
    return vBundled > vInstalled
}

/// 对外入口：确保 Chrome 的 manifest 已安装/升级
enum ManifestInstaller {
    /// 在后台线程调用
    static func ensureChromeManifestInstalled() {
        DispatchQueue.global(qos: .utility).async {
            do {
                // 1) 读取资源中的清单
                let (bundledData, bundled) = try loadBundledManifest()
                
                // 2) 目标路径
                let dstURL = chromeManifestURL()
                let fm = FileManager.default
                
                // 3) 如果不存在 → 直接写入
                if !fm.fileExists(atPath: dstURL.path) {
                    try atomicWrite(bundledData, to: dstURL)
                    print("Manifest installed to:", dstURL.path)
                    return
                }
                
                // 4) 存在 → 比较版本
                let installed = try? loadInstalledManifest(at: dstURL)
                if shouldOverwrite(installed: installed, bundled: bundled) {
                    // 可选：备份旧版
                    if installed != nil {
                        let bakURL = dstURL.deletingPathExtension()
                            .appendingPathExtension("backup.\(Date().timeIntervalSince1970).json")
                        try? fm.copyItem(at: dstURL, to: bakURL)
                    }
                    try atomicWrite(bundledData, to: dstURL)
                    print("Manifest upgraded at:", dstURL.path)
                } else {
                    print("Manifest up-to-date. (installed v\(installed?.version ?? 0), bundled v\(bundled.version ?? 0))")
                }
            } catch {
                print("Manifest install error:", error.localizedDescription)
            }
        }
    }
}
