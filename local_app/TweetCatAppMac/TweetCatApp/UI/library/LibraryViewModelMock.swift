//
//  LibraryViewModelMock.swift
//  TweetCatApp
//
//  Created by wesley on 2025/9/10.
//

import Foundation

@MainActor
final class LibraryViewModelMock: ObservableObject {
    @Published var segment: LibraryCategory = .watch
    @Published var sort: LibrarySort = .dateDesc
    @Published var query: String = ""
    @Published var items: [LibraryItem] = []

    init() { seedMock() }

    func seedMock() {
        let now = Date()
        items = [
            .init(
                title: "SwiftUI x yt-dlp：下载器 Demo",
                videoId: "abc123xyz",
                thumbURL: URL(
                    string: "https://via.placeholder.com/160x90.png?text=W1"
                ),
                fileName: "swiftui-demo.mp4",
                fileSizeMB: 85,
                createdAt: now.addingTimeInterval(-3600),
                category: .watch
            ),
            .init(
                title: "Shorts：极简 30 秒演示",
                videoId: "shorts-001",
                thumbURL: URL(
                    string: "https://via.placeholder.com/160x90.png?text=S1"
                ),
                fileName: "shorts-001.mp4",
                fileSizeMB: 10,
                createdAt: now.addingTimeInterval(-7200),
                category: .shorts
            ),
            .init(
                title: "示例：WWDC 片段",
                videoId: "wwdc-2024-clip",
                thumbURL: URL(
                    string: "https://via.placeholder.com/160x90.png?text=W2"
                ),
                fileName: "wwdc-clip.mp4",
                fileSizeMB: 120,
                createdAt: now.addingTimeInterval(-86400 * 2),
                category: .watch
            ),
            .init(
                title: "示例：Shorts 教程",
                videoId: "shorts-777",
                thumbURL: URL(
                    string: "https://via.placeholder.com/160x90.png?text=S2"
                ),
                fileName: "shorts-777.mp4",
                fileSizeMB: 9,
                createdAt: now.addingTimeInterval(-86400),
                category: .shorts
            ),
        ]
    }

    // MARK: - Derived
    var filteredAndSorted: [LibraryItem] {
        let base =
            items
            .filter { $0.category == segment }
            .filter {
                query.isEmpty
                    ? true
                    : $0.title.localizedCaseInsensitiveContains(query)
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

    // MARK: - Actions (假实现)
    func play(_ id: UUID) {
        // 仅演示：不接系统播放器
    }
    func reveal(_ id: UUID) {
        // 仅演示：不调 Finder
    }
    func delete(_ id: UUID) {
        if let idx = items.firstIndex(where: { $0.id == id }) {
            items.remove(at: idx)
        }
    }
    func moveToOtherCategory(_ id: UUID) {
        guard let idx = items.firstIndex(where: { $0.id == id }) else { return }
        items[idx].category = (items[idx].category == .watch) ? .shorts : .watch
    }
}
