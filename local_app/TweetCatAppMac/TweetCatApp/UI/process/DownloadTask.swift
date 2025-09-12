//
//  DownloadState.swift
//  TweetCatApp
//
//  Created by wesley on 2025/9/12.
//

import Foundation
import SwiftUI

// 下载状态
enum DownloadState {
    case queued
    case running
    case merging
    case done
    case failed
}

// 下载任务模型
struct DownloadTask: Identifiable {
    let id: String  // ← videoId 作为唯一 id
    var videoId: String
    var title: String
    var formatSummary: String
    var progress: Double  // 0.0 ~ 1.0
    var speedText: String
    var etaText: String
    var downloadedText: String
    var state: DownloadState
    var errorMessage: String?
    var thumbURL: URL?
    var filepath: String?
    var updatedAt: Date
}

// 下载中心（数据源）
@MainActor
class DownloadCenter: ObservableObject {
    @Published private(set) var items: [DownloadTask] = []
    private var tasks: [String: DownloadTask] = [:]  // ← String key

    func addTask(_ task: DownloadTask) {
        var t = task
        t.updatedAt = Date()
        tasks[t.id] = t
        refreshItems()
    }

    func updateTask(_ id: String, mutate: (inout DownloadTask) -> Void) {
        guard var task = tasks[id] else { return }
        mutate(&task)
        task.updatedAt = Date()
        tasks[id] = task
        refreshItems()
    }

    private func refreshItems() {
        items = Array(tasks.values)
    }
}

extension DownloadCenter {

    @MainActor
    func handleDownloadEvent(_ line: String, taskId: String) {
        // 原始行
        print("[DL][raw] \(line)")

        // 解析
        guard
            let data = line.data(using: .utf8),
            let obj = try? JSONSerialization.jsonObject(with: data)
                as? [String: Any],
            let event = obj["event"] as? String
        else {
            print("[DL][warn] parse failed")
            return
        }

        // 统一头
        print("[DL][event] \(event)")
        // 也打印一份美化后的 JSON 供排查
        ppJSON(obj)

        switch event {
        case "start":
            updateTask(taskId) { $0.state = .running }

        case "progress":

            let percentOpt = obj["percent"] as? Double
            let downloaded = obj["downloaded"] as? Double ?? 0
            let total = obj["total"] as? Double ?? 0
            let speed = obj["speed"] as? Double ?? 0
            let etaSec = obj["eta"] as? Int ?? 0
            let phase = obj["phase"] as? String

            updateTask(taskId) { task in
                if let p = percentOpt { task.progress = p }

                // 格式化文本
                task.speedText =
                    speed > 0
                    ? String(format: "%.1f MB/s", speed / 1024 / 1024) : ""
                task.etaText =
                    etaSec > 0
                    ? String(format: "%02d:%02d", etaSec / 60, etaSec % 60)
                    : ""
                task.downloadedText =
                    total > 0
                    ? "\(formatBytes(downloaded)) / \(formatBytes(total))"
                    : formatBytes(downloaded)

                task.state = .running
                if phase == "finished" {
                    task.progress = max(task.progress, 1.0)
                }

                if let filename = obj["filename"] as? String {
                    task.filepath = filename
                }
            }

        case "merging":
            updateTask(taskId) { task in
                task.state = .merging
                task.speedText = "合并…"
                task.etaText = ""
                task.downloadedText = ""
            }

        case "done":
            updateTask(taskId) { task in
                task.state = .done
                task.progress = 1.0
                task.speedText = ""
                task.etaText = ""
                task.downloadedText = "已完成"

            }

        case "error":
            let errMsg: String
            if let errDict = obj["error"] as? [String: Any],
                let msg = errDict["message"] as? String
            {
                errMsg = msg
            } else {
                errMsg = obj["error"] as? String ?? "未知错误"
            }
            updateTask(taskId) { task in
                task.state = .failed
                task.errorMessage = errMsg
                task.speedText = ""
                task.etaText = ""
                task.downloadedText = ""

            }
        default:
            break
        }
    }

    private func formatBytes(_ bytes: Double) -> String {
        let formatter = ByteCountFormatter()
        formatter.countStyle = .file
        return formatter.string(fromByteCount: Int64(bytes))
    }

    // MARK: - Debug helpers (仅日志用)
    private func ppJSON(_ dict: [String: Any]) {
        guard
            let data = try? JSONSerialization.data(
                withJSONObject: dict,
                options: [.prettyPrinted, .withoutEscapingSlashes]
            ),
            let s = String(data: data, encoding: .utf8)
        else { return }
        print("[DL][json]\n\(s)")
    }

    private func val(_ dict: [String: Any], _ key: String) -> Double? {
        if let d = dict[key] as? Double { return d }
        if let n = dict[key] as? NSNumber { return n.doubleValue }
        if let s = dict[key] as? String, let d = Double(s) { return d }
        return nil
    }
}
