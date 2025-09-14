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
    static let shared: LibraryCenter = MainActor.assumeIsolated { LibraryCenter() }
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

    func add(from task: DownloadTask) {
        let fileName =
            (task.filepath as NSString?)?.lastPathComponent
            ?? "\(task.videoId).mp4"

        // 默认大小 0
        var fileSizeMB: Double = 0

        if let filepath = task.filepath {
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
        if let idx = items.firstIndex(where: { $0.id == id }) {
            items[idx].category =
                (items[idx].category == .watch) ? .shorts : .watch
            scheduleSave()
        }
    }
}
