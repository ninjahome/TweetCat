//
//  LibraryViewModel.swift
//  TweetCatApp
//

import AppKit  // NSWorkspace (播放/在 Finder 中显示)
import Combine
import Foundation

@MainActor
final class LibraryViewModel: ObservableObject {

    // MARK: - Inputs (绑定到 UI)
    @Published var segment: LibraryCategory = .watch
    @Published var sort: LibrarySort = .dateDesc
    @Published var query: String = ""

    // 来自 LibraryCenter 的数据快照
    @Published var items: [LibraryItem] = []

    // MARK: - Private
    private var cancellables = Set<AnyCancellable>()

    // MARK: - Init
    init() {
        self.items = LibraryCenter.shared.items

        LibraryCenter.shared.$items
            .receive(on: DispatchQueue.main)
            .sink { [weak self] newItems in
                self?.items = newItems
            }
            .store(in: &cancellables)
    }

    deinit {
        cancellables.removeAll()
    }

    // MARK: - Derived
    var filteredAndSorted: [LibraryItem] {
        let base =
            items
            .filter { $0.category == segment }
            .filter {
                guard !query.isEmpty else { return true }
                return $0.title.localizedCaseInsensitiveContains(query)
                    || $0.videoId.localizedCaseInsensitiveContains(query)
                    || $0.fileName.localizedCaseInsensitiveContains(query)
            }

        switch sort {
        case .dateDesc: return base.sorted { $0.createdAt > $1.createdAt }
        case .dateAsc: return base.sorted { $0.createdAt < $1.createdAt }
        case .sizeDesc: return base.sorted { $0.fileSizeMB > $1.fileSizeMB }
        case .sizeAsc: return base.sorted { $0.fileSizeMB < $1.fileSizeMB }
        case .nameAsc:
            return base.sorted {
                $0.title.localizedCompare($1.title) == .orderedAscending
            }
        case .nameDesc:
            return base.sorted {
                $0.title.localizedCompare($1.title) == .orderedDescending
            }
        }
    }

    // MARK: - Actions

    /// 播放（系统默认播放器）
    func play(_ id: UUID) {
        guard let item = items.first(where: { $0.id == id }) else { return }
        guard let url = resolveFileURL(for: item) else {
            GlobalAlertManager.shared.show(
                title: "播放失败",
                message: "找不到文件路径：\(item.fileName)",
                onConfirm: { LibraryCenter.shared.delete(id) }
            )
            return
        }
        
        if !FileManager.default.fileExists(atPath: url.path) {
            GlobalAlertManager.shared.show(
                title: "播放失败",
                message: "文件已丢失：\(item.fileName)",
                onConfirm: { LibraryCenter.shared.delete(id) }
            )
            return
        }
        NSWorkspace.shared.open(url)
    }

    /// 在 Finder 中显示
    func reveal(_ id: UUID) {
        guard let item = items.first(where: { $0.id == id }) else { return }
        guard let url = resolveFileURL(for: item) else {
            GlobalAlertManager.shared.show(
                title: "无法显示",
                message: "找不到文件路径：\(item.fileName)",
                onConfirm: { LibraryCenter.shared.delete(id) }
            )
            return
        }
        if !FileManager.default.fileExists(atPath: url.path) {
            GlobalAlertManager.shared.show(
                title: "无法显示",
                message: "文件已丢失：\(item.fileName)",
                onConfirm: { LibraryCenter.shared.delete(id) }
            )
            return
        }
        NSWorkspace.shared.activateFileViewerSelecting([url])
    }

    /// 删除记录（可选删除物理文件）
    func delete(_ id: UUID, alsoDeleteFile: Bool = false) {
        guard let item = items.first(where: { $0.id == id }) else { return }

        if alsoDeleteFile, let url = resolveFileURL(for: item) {
            do {
                try FileManager.default.removeItem(at: url)
            } catch let error as NSError {
                if error.domain == NSCocoaErrorDomain,
                    error.code == NSFileNoSuchFileError
                {
                    print(
                        "未找到文件" + url.absoluteString + " error:"
                            + error.localizedDescription
                    )
                } else {
                    GlobalAlertManager.shared.show(
                        title: "删除失败",
                        message: "无法删除文件：\(error.localizedDescription)",
                        onConfirm: {}
                    )
                }
            }
        }

        LibraryCenter.shared.delete(id)
    }

    /// 移动分类（Watch ↔ Shorts）
    func moveToOtherCategory(_ id: UUID) {
        LibraryCenter.shared.moveToOtherCategory(id)
    }

    // MARK: - Helpers

    /// ~/Downloads/TweetCat/<shorts|watch>/<fileName>
    private func resolveFileURL(for item: LibraryItem) -> URL? {
        let home = FileManager.default.homeDirectoryForCurrentUser
        let catFolder = (item.category == .shorts) ? "shorts" : "watch"
        let dir =
            home
            .appendingPathComponent("Downloads", isDirectory: true)
            .appendingPathComponent("TweetCat", isDirectory: true)
            .appendingPathComponent(catFolder, isDirectory: true)
        return dir.appendingPathComponent(item.fileName, isDirectory: false)
    }
}
