import AppKit
// LogsViewModel.swift
import Foundation

@MainActor
final class LogsViewModel: ObservableObject {
    @Published var sourceFilter: SourceFilter = .all
    @Published var levelFilter: LevelFilter = .all
    @Published var query: String = ""
    @Published var autoScroll: Bool = true
    @Published var paused: Bool = false
    @Published var lines: [LogLine] = []
    @Published var exportedPath: String? = nil

    enum SourceFilter: String, CaseIterable, Identifiable {
        case all = "全部来源"
        case host = "host"
        case ui = "ui"
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

    // 添加日志入口
    func append(_ line: LogLine) {
        guard !paused else { return }
        lines.append(line)
        if lines.count > 2000 { lines.removeFirst(lines.count - 2000) }
    }

    // 过滤
    var filtered: [LogLine] {
        lines.filter { line in
            switch sourceFilter {
            case .all: true
            case .host: line.source == .host
            case .ui: line.source == .ui
            case .ytdlp: line.source == .ytdlp
            }
        }
        .filter { line in
            switch levelFilter {
            case .all: true
            case .info: line.level == .info
            case .warn: line.level == .warn
            case .error: line.level == .error
            }
        }
        .filter { line in
            query.isEmpty
                ? true
                : line.message.localizedCaseInsensitiveContains(query)
                    || line.source.rawValue.localizedCaseInsensitiveContains(
                        query
                    )
                    || line.level.rawValue.localizedCaseInsensitiveContains(
                        query
                    )
                    || (line.taskId?.localizedCaseInsensitiveContains(query)
                        ?? false)
        }
    }

    func clear() { lines.removeAll() }

    func copyAll() {
        let pb = NSPasteboard.general
        pb.clearContents()
        pb.setString(exportText(lines: filtered), forType: .string)
    }

    func exportAll() {
        let text = exportText(lines: filtered)
        let savePanel = NSSavePanel()
        savePanel.title = "导出日志"
        savePanel.nameFieldStringValue =
            "TweetCat-logs-\(Int(Date().timeIntervalSince1970)).txt"
        savePanel.allowedContentTypes = [.plainText]  // macOS 12+，限制为 txt 文件
        savePanel.canCreateDirectories = true

        if savePanel.runModal() == .OK, let url = savePanel.url {
            do {
                try text.data(using: .utf8)?.write(to: url)
                exportedPath = url.path
            } catch {
                exportedPath = "导出失败：\(error.localizedDescription)"
            }
        } else {
            exportedPath = "用户取消导出"
        }
    }

    private func exportText(lines: [LogLine]) -> String {
        lines.map { l in
            "[\(fmtTime(l.time))] \(l.source.rawValue) \(l.level.rawValue)\(l.taskId != nil ? " [\(l.taskId!)]" : "") - \(l.message)"
        }.joined(separator: "\n")
    }

    private func fmtTime(_ d: Date) -> String {
        let f = DateFormatter()
        f.dateFormat = "HH:mm:ss.SSS"
        return f.string(from: d)
    }
}

@MainActor
class LogsCenter {
    static let shared = LogsCenter()
    let vm = LogsViewModel()

    func log(
        source: LogSource,
        level: LogLevel,
        message: String,
        taskId: String? = nil
    ) {
        vm.append(
            LogLine(
                time: Date(),
                source: source,
                level: level,
                message: message,
                taskId: taskId
            )
        )
    }
}
