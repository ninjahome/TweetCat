//
//  LogsViewModelMock.swift
//  TweetCatApp
//
//  Created by wesley on 2025/9/10.
//


import Foundation
import AppKit

@MainActor
final class LogsViewModelMock: ObservableObject {
    // 过滤与查找
    @Published var sourceFilter: SourceFilter = .all
    @Published var levelFilter: LevelFilter = .all
    @Published var query: String = ""
    @Published var autoScroll: Bool = true
    @Published var paused: Bool = false

    // 日志行
    @Published var lines: [LogLine] = []

    // 导出提示
    @Published var exportedPath: String? = nil

    private var timer: Timer?

    enum SourceFilter: String, CaseIterable, Identifiable {
        case all = "全部来源"
        case host = "host"
        case ui   = "ui"
        case ytdlp = "yt-dlp"
        var id: String { rawValue }
    }

    enum LevelFilter: String, CaseIterable, Identifiable {
        case all = "全部级别"
        case info = "info"
        case warn = "warn"
        case error = "error"
        var id: String { rawValue }
    }

    init() {
        seed()
        startMockStreaming()
    }

    func seed() {
        let now = Date()
        lines = [
            .init(time: now.addingTimeInterval(-3), source: .ui, level: .info, message: "App started (mock)", taskId: nil),
            .init(time: now.addingTimeInterval(-2), source: .host, level: .info, message: "Received native-message handshake (mock)", taskId: nil),
            .init(time: now.addingTimeInterval(-1), source: .ytdlp, level: .warn, message: "ffmpeg not found in PATH, fallback to built-in (mock)", taskId: "abc123")
        ]
    }

    // 模拟日志流
    func startMockStreaming() {
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 0.7, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                guard !self.paused else { return }

                let srcs: [LogSource] = [.ui, .host, .ytdlp]
                let lvls: [LogLevel] = [.info, .warn, .error]
                let src = srcs.randomElement()!
                let lvl = lvls.randomElement()!
                let msg = self.randomMessage(src: src, lvl: lvl)

                self.lines.append(.init(time: Date(), source: src, level: lvl, message: msg, taskId: Bool.random() ? "task-\(Int.random(in: 100...999))" : nil))
                if self.lines.count > 2000 { self.lines.removeFirst(self.lines.count - 2000) }
            }
        }
        RunLoop.main.add(timer!, forMode: .common)
    }

    func stopMockStreaming() {
        timer?.invalidate()
        timer = nil
    }

    // 过滤后的结果
    var filtered: [LogLine] {
        lines.filter { line in
            // source
            switch sourceFilter {
            case .all: true
            case .host: line.source == .host
            case .ui: line.source == .ui
            case .ytdlp: line.source == .ytdlp
            }
        }
        .filter { line in
            // level
            switch levelFilter {
            case .all: true
            case .info: line.level == .info
            case .warn: line.level == .warn
            case .error: line.level == .error
            }
        }
        .filter { line in
            query.isEmpty ? true :
                line.message.localizedCaseInsensitiveContains(query)
             || line.source.rawValue.localizedCaseInsensitiveContains(query)
             || line.level.rawValue.localizedCaseInsensitiveContains(query)
             || (line.taskId?.localizedCaseInsensitiveContains(query) ?? false)
        }
    }

    // 操作
    func clear() {
        lines.removeAll()
    }

    func copyAll() {
        let pb = NSPasteboard.general
        pb.clearContents()
        pb.setString(exportText(lines: filtered), forType: .string)
    }

    func exportAll() {
        let text = exportText(lines: filtered)
        let fileName = "TweetCat-logs-\(Int(Date().timeIntervalSince1970)).txt"
        let desktop = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Desktop")
            .appendingPathComponent(fileName)
        do {
            try text.data(using: .utf8)?.write(to: desktop)
            exportedPath = desktop.path
        } catch {
            exportedPath = "导出失败：\(error.localizedDescription)"
        }
    }

    private func exportText(lines: [LogLine]) -> String {
        lines.map { l in
            "[\(fmtTime(l.time))] \(l.source.rawValue) \(l.level.rawValue)\(l.taskId != nil ? " [\(l.taskId!)]" : "") - \(l.message)"
        }.joined(separator: "\n")
    }

    // MARK: helpers
    private func fmtTime(_ d: Date) -> String {
        let f = DateFormatter()
        f.dateFormat = "HH:mm:ss.SSS"
        return f.string(from: d)
    }

    private func randomMessage(src: LogSource, lvl: LogLevel) -> String {
        switch (src, lvl) {
        case (.ui, .info):  return "User tapped Start Download (mock)"
        case (.ui, .warn):  return "UI throttled excessive updates (mock)"
        case (.ui, .error): return "Failed to parse URL (mock)"
        case (.host, .info):  return "NativeMessage: candidate received {title, id} (mock)"
        case (.host, .warn):  return "Host queue backpressure (mock)"
        case (.host, .error): return "Host IPC timeout (mock)"
        case (.ytdlp, .info):  return "yt-dlp: fetching formats... (mock)"
        case (.ytdlp, .warn):  return "yt-dlp: slow connection detected (mock)"
        case (.ytdlp, .error): return "yt-dlp: ERROR: 403 Forbidden (mock)"
        }
    }
}
