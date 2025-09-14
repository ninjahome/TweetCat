//
//  AppConfigManager.swift
//  TweetCatApp
//
//  Created by wesley on 2025/9/14.
//
import SwiftUI

struct AppConfig: Codable {
    static let defaultPath = URL(filePath: "~/Downloads/TweetCat")
    var downloadRoot: String  // 用户自定义的根目录，比如 ~/Downloads/TweetCat
    var manualProxy: ManualProxyForm?
    var notifyDone: Bool = true
    var notifyFail: Bool = true

    /// 返回某个子分类的路径（自动创建目录）
    func path(for category: String) -> URL {
        // 展开 ~
        let expandedRoot = (downloadRoot as NSString).expandingTildeInPath
        let rootURL = URL(fileURLWithPath: expandedRoot, isDirectory: true)

        let target = rootURL.appendingPathComponent(category, isDirectory: true)

        // 确保目录存在
        try? FileManager.default.createDirectory(
            at: target,
            withIntermediateDirectories: true,
            attributes: nil
        )

        return target
    }
}

class AppConfigManager {
    static let shared = AppConfigManager()
    private init() {}

    private var configURL: URL {
        let support = FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first!
        let dir = support.appendingPathComponent(
            "TweetCat",
            isDirectory: true
        )
        if !FileManager.default.fileExists(atPath: dir.path) {
            try? FileManager.default.createDirectory(
                at: dir,
                withIntermediateDirectories: true
            )
        }
        return dir.appendingPathComponent("config.json")
    }

    func load() -> AppConfig {
        if !FileManager.default.fileExists(atPath: configURL.path) {
            return AppConfig(downloadRoot: "~/Downloads/TweetCat")
        }
        do {
            let data = try Data(contentsOf: configURL)
            return try JSONDecoder().decode(AppConfig.self, from: data)
        } catch {
            print("⚠️ 配置读取失败: \(error)")
            // 返回一个默认配置，避免外部还要处理 nil
            return AppConfig(downloadRoot: "~/Downloads/TweetCat")
        }
    }

    func save(_ config: AppConfig) {
        do {
            let data = try JSONEncoder().encode(config)
            try data.write(to: configURL, options: .atomic)
        } catch {
            print("⚠️ 配置保存失败: \(error)")
        }
    }
}
