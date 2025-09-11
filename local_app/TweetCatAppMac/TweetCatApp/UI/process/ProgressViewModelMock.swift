//
//  ProgressViewModelMock.swift
//  TweetCatApp
//
//  Created by wesley on 2025/9/10.
//

import Foundation

@MainActor
final class ProgressViewModelMock: ObservableObject {
    @Published var filter: Filter = .all
    @Published var items: [MockDownloadTask] = []

    private var timers: [UUID: Timer] = [:]

    enum Filter: String, CaseIterable, Identifiable {
        case all = "全部"
        case running = "进行中"
        case done = "已完成"
        case failed = "失败"
        var id: String { rawValue }
    }

    init() {
        seedMock()
    }

    func seedMock() {
        items = [
            .init(
                title: "SwiftUI x yt-dlp：下载器 Demo",
                videoId: "abc123xyz",
                thumbURL: URL(
                    string:
                        "https://via.placeholder.com/160x90.png?text=1"
                ),
                formatSummary: "Best(1080p)/mp4",
                state: .running,
                progress: 0.18,
                speedText: "3.1 MB/s",
                etaText: "00:42",
                downloadedText: "15 / 85 MB",
                errorMessage: nil
            ),
            .init(
                title: "Shorts：极简 30 秒演示",
                videoId: "shorts-001",
                thumbURL: URL(
                    string:
                        "https://via.placeholder.com/160x90.png?text=2"
                ),
                formatSummary: "Best/mp4",
                state: .queued,
                progress: 0.0,
                speedText: nil,
                etaText: nil,
                downloadedText: nil,
                errorMessage: nil
            ),
            .init(
                title: "示例：之前已完成的长视频",
                videoId: "done-777",
                thumbURL: URL(
                    string:
                        "https://via.placeholder.com/160x90.png?text=3"
                ),
                formatSummary: "720p/mp4",
                state: .done,
                progress: 1.0,
                speedText: nil,
                etaText: nil,
                downloadedText: "85 / 85 MB",
                errorMessage: nil
            ),
            .init(
                title: "示例：曾失败的任务",
                videoId: "fail-404",
                thumbURL: URL(
                    string:
                        "https://via.placeholder.com/160x90.png?text=4"
                ),
                formatSummary: "Audio/m4a",
                state: .failed,
                progress: 0.0,
                speedText: nil,
                etaText: nil,
                downloadedText: "0 / 8 MB",
                errorMessage: "网络超时（假）"
            ),
        ]
        // 自动为第一个 running 的任务挂个计时器
        if let first = items.first(where: { $0.state == .running }) {
            startSimulate(for: first.id)
        }
    }

    // MARK: - 过滤后的视图
    var filteredItems: [MockDownloadTask] {
        switch filter {
        case .all: return items
        case .running:
            return items.filter {
                $0.state == .running || $0.state == .queued
                    || $0.state == .merging
                    || $0.state == .paused
            }
        case .done: return items.filter { $0.state == .done }
        case .failed: return items.filter { $0.state == .failed }
        }
    }

    // MARK: - 控制
    func pause(_ id: UUID) {
        guard let idx = items.firstIndex(where: { $0.id == id }) else {
            return
        }
        timers[id]?.invalidate()
        timers[id] = nil
        items[idx].state = .paused
        items[idx].speedText = nil
        items[idx].etaText = nil
    }

    func resume(_ id: UUID) {
        guard let idx = items.firstIndex(where: { $0.id == id }) else {
            return
        }
        if items[idx].state == .queued { items[idx].state = .running }
        if items[idx].state == .paused { items[idx].state = .running }
        startSimulate(for: id)
    }

    func cancel(_ id: UUID) {
        timers[id]?.invalidate()
        timers[id] = nil
        if let idx = items.firstIndex(where: { $0.id == id }) {
            items.remove(at: idx)
        }
    }

    func retry(_ id: UUID) {
        guard let idx = items.firstIndex(where: { $0.id == id }) else {
            return
        }
        items[idx].state = .running
        items[idx].progress = 0.0
        items[idx].errorMessage = nil
        startSimulate(for: id)
    }

    func revealInFinder(_ id: UUID) {
        // 假功能：这里先不实现与系统交互
    }

    // MARK: - 模拟下载
    private func startSimulate(for id: UUID) {
        timers[id]?.invalidate()

        guard let idx = items.firstIndex(where: { $0.id == id }) else {
            return
        }
        items[idx].state = .running

        let timer = Timer.scheduledTimer(
            withTimeInterval: 0.2,
            repeats: true
        ) { [weak self] t in
            Task { @MainActor in
                guard let self,
                    let i = self.items.firstIndex(where: {
                        $0.id == id
                    })
                else { return }

                // 如果不在 running，就停表
                guard self.items[i].state == .running else {
                    t.invalidate()
                    self.timers[id] = nil
                    return
                }

                let p =
                    self.items[i].progress
                    + Double.random(in: 0.01...0.03)
                if p >= 1.0 {
                    self.items[i].state = .merging
                    self.items[i].progress = 1.0
                    self.items[i].speedText = "合并…"
                    self.items[i].etaText = nil
                    self.items[i].downloadedText = nil

                    // 合并 1 秒后完成
                    Timer.scheduledTimer(
                        withTimeInterval: 1.0,
                        repeats: false
                    ) { _ in
                        Task { @MainActor in
                            if let j = self.items
                                .firstIndex(
                                    where: {
                                        $0
                                            .id
                                            == id
                                    })
                            {
                                self.items[j]
                                    .state =
                                    .done
                                self.items[j]
                                    .speedText =
                                    nil
                                self.items[j]
                                    .etaText =
                                    nil
                                self.items[j]
                                    .downloadedText =
                                    "已完成"
                                self.timers[id]?
                                    .invalidate()
                                self.timers[
                                    id
                                ] = nil
                            }
                        }
                    }
                    t.invalidate()
                    self.timers[id] = nil
                } else {
                    self.items[i].progress = p
                    // 生成一些友好的文本
                    let totalMB: Double = 85
                    let downloaded = totalMB * p
                    self.items[i].speedText = String(
                        format: "%.1f MB/s",
                        Double.random(in: 2.5...4.2)
                    )
                    self.items[i].etaText = String(
                        format: "00:%02d",
                        Int((1.0 - p) * 60)
                    )
                    self.items[i].downloadedText = String(
                        format: "%.0f / %.0f MB",
                        downloaded,
                        totalMB
                    )
                }
            }
        }
        RunLoop.main.add(timer, forMode: .common)
        timers[id] = timer
    }
}
