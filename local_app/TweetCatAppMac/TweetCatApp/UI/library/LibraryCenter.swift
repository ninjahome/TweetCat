//
//  LibraryCenter.swift
//  TweetCatApp
//
//  Created by wesley on 2025/9/12.
//

import Foundation
import SwiftUI

@MainActor
final class LibraryCenter: ObservableObject {
    static let shared: LibraryCenter = MainActor.assumeIsolated {
        LibraryCenter()
    }
    private init() {}  // ← 禁止外部 init

    @Published private(set) var items: [LibraryItem] = []
    private var pendingSaveWork: DispatchWorkItem?

    private var fileURL: URL {
        let fm = FileManager.default
        let dir = fm.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first!
        .appendingPathComponent("TweetCat", isDirectory: true)
        if !fm.fileExists(atPath: dir.path) {
            try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        }
        return dir.appendingPathComponent("library.json")
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

    // MARK: - 加载
    func load() {
        guard let data = try? Data(contentsOf: fileURL) else { return }
        if let decoded = try? decoder.decode([LibraryItem].self, from: data) {
            items = decoded
        }
    }

    // MARK: - 保存（节流）
    private func scheduleSave() {
        pendingSaveWork?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.save() }
        pendingSaveWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3, execute: work)
    }

    private func save() {
        do {
            let data = try encoder.encode(items)
            let tmp = fileURL.appendingPathExtension("tmp")
            try data.write(to: tmp, options: .atomic)
            try? FileManager.default.removeItem(at: fileURL)
            try FileManager.default.moveItem(at: tmp, to: fileURL)
        } catch {
            print("[persist][library] save failed: \(error)")
        }
    }

    func add(
        from task: DownloadTask,
        overrideFileName: String? = nil,
        overrideFileSizeMB: Int? = nil
    ) {
        let fileName =
            overrideFileName
            ?? (task.filepath as NSString?)?.lastPathComponent
            ?? "\(task.videoId).mp4"

        var fileSizeMB: Double = Double(overrideFileSizeMB ?? 0)

        // fallback：如果没有传回 filesize，就自己查
        if fileSizeMB <= 0, let filepath = task.filepath {
            let fileURL = URL(fileURLWithPath: filepath)
            if let attrs = try? FileManager.default.attributesOfItem(
                atPath: fileURL.path
            ),
                let size = attrs[.size] as? NSNumber
            {
                fileSizeMB = Double(size.int64Value) / 1024.0 / 1024.0
            }
        }

        let item = LibraryItem(
            title: task.title,
            videoId: task.videoId,
            thumbURL: task.thumbURL,
            fileName: fileName,
            fileSizeMB: Int(fileSizeMB),
            createdAt: Date(),
            category: task.pageTyp == "shorts" ? .shorts : .watch
        )
        add(item)
    }

    // MARK: - 增删改
    func add(_ item: LibraryItem) {
        items.insert(item, at: 0)  // 新任务排最前
        scheduleSave()
    }

    func delete(_ id: UUID) {
        if let idx = items.firstIndex(where: { $0.id == id }) {
            items.remove(at: idx)
            scheduleSave()
        }
    }

    func moveToOtherCategory(_ id: UUID) {
        guard let idx = items.firstIndex(where: { $0.id == id }) else { return }
        var item = items[idx]

        // 原始目录
        let home = FileManager.default.homeDirectoryForCurrentUser
        let oldCat = item.category == .watch ? "watch" : "shorts"
        let newCat = item.category == .watch ? "shorts" : "watch"

        let oldURL =
            home
            .appendingPathComponent("Downloads", isDirectory: true)
            .appendingPathComponent("TweetCat", isDirectory: true)
            .appendingPathComponent(oldCat, isDirectory: true)
            .appendingPathComponent(item.fileName)

        let newDir =
            home
            .appendingPathComponent("Downloads", isDirectory: true)
            .appendingPathComponent("TweetCat", isDirectory: true)
            .appendingPathComponent(newCat, isDirectory: true)

        let newURL = newDir.appendingPathComponent(item.fileName)

        do {
            try FileManager.default.createDirectory(
                at: newDir,
                withIntermediateDirectories: true
            )
            if FileManager.default.fileExists(atPath: oldURL.path) {
                try FileManager.default.moveItem(at: oldURL, to: newURL)
            }
            // 更新逻辑分类
            item.category = (item.category == .watch) ? .shorts : .watch
            items[idx] = item
            scheduleSave()
        } catch {
            GlobalAlertManager.shared.show(
                title: "移动失败",
                message: "无法移动文件：\(error.localizedDescription)",
                onConfirm: {}
            )
        }
    }

}
