//
//  TempInfoCache.swift
//  TweetCatApp
//
//  Created by wesley on 2025/9/12.
//

//
//  TempInfoCache.swift
//  TweetCatApp
//

import Foundation

/// 统一的“临时缓存”（YTDLPInfo）：
/// - 先查内存 [String:Payload]
/// - 未命中再查磁盘 ~/Library/Caches/ydl-info/<videoID>.json
/// - 命中即回填内存
/// - 写入同时写内存与磁盘
final class TempInfoCache {

    static let shared = TempInfoCache()

    /// 默认 TTL：48 小时（可按需改）
    private let ttl: TimeInterval = 48 * 3600

    /// 内存缓存（带时间戳），并发读、串行写
    private let queue = DispatchQueue(
        label: "tempinfo.cache.queue",
        attributes: .concurrent
    )
    private var mem: [String: Payload] = [:]

    /// 磁盘目录：~/Library/Caches/ydl-info
    private let baseDir: URL = {
        let dir = FileManager.default.urls(
            for: .cachesDirectory,
            in: .userDomainMask
        )[0]
        .appendingPathComponent("ydl-info", isDirectory: true)
        try? FileManager.default.createDirectory(
            at: dir,
            withIntermediateDirectories: true
        )
        return dir
    }()

    private init() {}

    // MARK: - Public API

    /// 读取（先内存、后磁盘；命中回填内存）
    func get(videoID: String) -> YTDLP.YTDLPInfo? {
        // 1) 读内存
        if let info = getFromMemory(videoID) {
            return info
        }
        // 2) 读磁盘
        if let info = loadFromDisk(videoID) {
            // 回填内存
            let payload = Payload(savedAt: Date(), info: info)
            setToMemory(videoID, payload: payload)
            return info
        }
        return nil
    }

    /// 写入（内存 + 磁盘）
    func set(videoID: String, info: YTDLP.YTDLPInfo) {
        let payload = Payload(savedAt: Date(), info: info)
        setToMemory(videoID, payload: payload)
        saveToDisk(videoID, payload: payload)
    }

    /// 删除单个 id
    func remove(videoID: String) {
        queue.async(flags: .barrier) {
            self.mem.removeValue(forKey: videoID)
        }
        let url = fileURL(for: videoID)
        try? FileManager.default.removeItem(at: url)
    }

    /// 清空（可选）
    func removeAll() {
        queue.async(flags: .barrier) { self.mem.removeAll() }
        if let files = try? FileManager.default.contentsOfDirectory(
            at: baseDir,
            includingPropertiesForKeys: nil
        ) {
            for f in files { try? FileManager.default.removeItem(at: f) }
        }
    }

    // MARK: - Model

    /// 磁盘/内存统一的载荷（带时间戳，方便判断 TTL）
    private struct Payload: Codable {
        let savedAt: Date
        let info: YTDLP.YTDLPInfo
    }

    // MARK: - Memory helpers

    private func getFromMemory(_ videoID: String) -> YTDLP.YTDLPInfo? {
        var payload: Payload?
        queue.sync { payload = mem[videoID] }
        guard let p = payload else { return nil }
        if isValid(p.savedAt) {
            return p.info
        } else {
            // 过期则清理内存项
            queue.async(flags: .barrier) {
                self.mem.removeValue(forKey: videoID)
            }
            return nil
        }
    }

    private func setToMemory(_ videoID: String, payload: Payload) {
        queue.async(flags: .barrier) { self.mem[videoID] = payload }
    }

    // MARK: - Disk helpers

    private func fileURL(for videoID: String) -> URL {
        // YouTube 的 videoID 一般安全；为保险起见把非 [A-Za-z0-9-_] 替换为 "_"
        let safe = videoID.replacingOccurrences(
            of: #"[^A-Za-z0-9\-_]"#,
            with: "_",
            options: .regularExpression
        )
        return baseDir.appendingPathComponent(
            "\(safe).json",
            isDirectory: false
        )
    }

    private func loadFromDisk(_ videoID: String) -> YTDLP.YTDLPInfo? {
        let url = fileURL(for: videoID)
        guard let data = try? Data(contentsOf: url) else { return nil }
        guard let payload = try? JSONDecoder().decode(Payload.self, from: data)
        else {
            // 解码失败时把坏文件删掉
            try? FileManager.default.removeItem(at: url)
            return nil
        }
        if isValid(payload.savedAt) {
            NSLog("TempInfoCache: hit disk cache for \(videoID)")
            return payload.info
        } else {
            // 过期删除
            try? FileManager.default.removeItem(at: url)
            return nil
        }
    }

    private func saveToDisk(_ videoID: String, payload: Payload) {
        let url = fileURL(for: videoID)
        if let data = try? JSONEncoder().encode(payload) {
            do {
                try data.write(to: url, options: .atomic)
            } catch {
                NSLog(
                    "TempInfoCache: write disk failed: \(error.localizedDescription)"
                )
            }
        }
    }

    // MARK: - TTL

    private func isValid(_ savedAt: Date) -> Bool {
        return Date().timeIntervalSince(savedAt) < ttl
    }
}
