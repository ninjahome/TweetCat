//
//  DownloadCenter.swift
//  TweetCatApp
//
//  Created by wesley on 2025/9/12.
//

import Foundation

// 下载中心（数据源）
@MainActor
class DownloadCenter: ObservableObject {
    static let shared = DownloadCenter()  // ← 单例实例
    private init() {}

    @Published private(set) var items: [DownloadTask] = []
    private var tasks: [String: DownloadTask] = [:]  // ← String key
    private var pendingSaveWork: DispatchWorkItem?

    func addTask(_ task: DownloadTask) {
        var t = task
        t.updatedAt = Date()
        tasks[t.id] = t
        refreshItems()
        scheduleSaveActive()
    }

    func updateTask(_ id: String, mutate: (inout DownloadTask) -> Void) {
        guard var task = tasks[id] else { return }
        mutate(&task)
        task.updatedAt = Date()
        tasks[id] = task
        refreshItems()
        scheduleSaveActive()
    }

    func removeTaskData(_ id: String) {
        tasks.removeValue(forKey: id)
        refreshItems()
        scheduleSaveActive()
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
            guard let finishedTask = tasks[taskId] else {
                return
            }

            DispatchQueue.main.async {
                LibraryCenter.shared.add(from: finishedTask)
                self.removeTaskData(taskId)
                print(
                    "[migrate] moved \(taskId) to library & removed from active"
                )
            }

        case "cancelled":
            updateTask(taskId) { task in
                task.state = .cancelled
                task.errorMessage = "已取消"
                task.speedText = ""
                task.etaText = ""
                task.downloadedText = ""
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
        WaitOverlayManager.shared.hide()
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

extension DownloadCenter {

    // MARK: - 持久化：路径 & 编解码器
    private var activeFileURL: URL {
        let fm = FileManager.default
        let dir = fm.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first!
        .appendingPathComponent("TweetCat", isDirectory: true)
        if !fm.fileExists(atPath: dir.path) {
            try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        }
        return dir.appendingPathComponent("active_tasks.json")
    }

    private var encoder: JSONEncoder {
        let e = JSONEncoder()
        e.outputFormatting = [.prettyPrinted, .sortedKeys]
        e.dateEncodingStrategy = .iso8601
        return e
    }

    private var decoder: JSONDecoder {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }

    private func scheduleSaveActive() {
        pendingSaveWork?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.saveActive() }
        pendingSaveWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3, execute: work)  // 300ms 合并
    }

    private func saveActive() {
        let toSave = tasks.values
            .filter { $0.state != .done }  // 只保存未完成
            .sorted { $0.updatedAt > $1.updatedAt }

        do {
            let data = try encoder.encode(toSave)
            let tmp = activeFileURL.appendingPathExtension("tmp")
            try data.write(to: tmp, options: .atomic)
            try? FileManager.default.removeItem(at: activeFileURL)
            try FileManager.default.moveItem(at: tmp, to: activeFileURL)
            // print("[persist] saved active: \(toSave.count)")
        } catch {
            print("[persist][active] save failed: \(error)")
        }
    }

    // MARK: - 加载（启动时调用）
    func loadActive() {
        guard let data = try? Data(contentsOf: activeFileURL) else { return }
        do {
            let decoded = try decoder.decode([DownloadTask].self, from: data)

            // 规范化：运行中态→可恢复（queued）；清空实时文本
            var restored: [String: DownloadTask] = [:]
            for var t in decoded {
                switch t.state {
                case .running, .merging:
                    t.state = .queued

                case .failed, .queued, .cancelled:
                    break  // 保持原样

                case .done:
                    continue  // 不应出现在 active，忽略
                }
                t.speedText = ""
                t.etaText = ""
                t.downloadedText = ""
                restored[t.id] = t
            }

            // 合并并刷新
            for (k, v) in restored { tasks[k] = v }
            refreshItems()
            // print("[persist] loaded active: \(restored.count)")
        } catch {
            print("[persist][active] load failed: \(error)")
        }
    }
}

// DownloadCenter.swift
extension DownloadCenter {
    func stopTask(_ id: String) {
        guard var task = tasks[id] else { return }
        task.state = .queued
        task.speedText = ""
        task.etaText = ""
        task.updatedAt = Date()
        tasks[id] = task
        saveActive()
    }

    func retryTask(
        _ id: String,
        onClose: @escaping (Result<Void, Error>) -> Void
    ) async {
        guard var task = tasks[id] else { return }
        task.state = .running
        tasks[id] = task
        saveActive()

        let cookiesPath = NSString(string: kTweetCatCookieFile).expandingTildeInPath
        let proxy = await prepareProxy()

        let cat = (task.pageTyp.lowercased() == "shorts") ? "shorts" : "watch"
        let urlString =
            (task.pageTyp.lowercased() == "shorts")
            ? "https://www.youtube.com/shorts?v=\(task.videoId)"
            : "https://www.youtube.com/watch?v=\(task.videoId)"

        let downloads = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Downloads", isDirectory: true)
            .appendingPathComponent("TweetCat", isDirectory: true)
            .appendingPathComponent(cat, isDirectory: true)

        // 确保目录存在
        try? FileManager.default.createDirectory(
            at: downloads,
            withIntermediateDirectories: true,
            attributes: nil
        )

        let outTmpl =
            downloads.path
            + "/%(title)s [%(height)sp-%(vcodec)s+%(acodec)s].%(ext)s"

        _ = YDLHelperSocket.shared.startDownload(
            taskID: id,
            url: urlString,
            formatValue: task.formatSummary,
            outputTemplate: outTmpl,
            cookiesFile: cookiesPath,
            proxy: proxy,
            onEvent: { line in
                Task { @MainActor in
                    DownloadCenter.shared.handleDownloadEvent(
                        line,
                        taskId: id
                    )
                }
            },
            onClose: onClose
        )
    }
}
