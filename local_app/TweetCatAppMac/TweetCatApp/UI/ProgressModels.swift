//
//  MockTaskState.swift
//  TweetCatApp
//
//  Created by wesley on 2025/9/10.
//

import Foundation

enum MockTaskState: String {
    case queued = "等待中"
    case running = "下载中"
    case paused = "已暂停"
    case merging = "合并中"
    case done = "已完成"
    case failed = "失败"
}

struct MockDownloadTask: Identifiable, Equatable {
    let id = UUID()
    var title: String
    var videoId: String
    var thumbURL: URL?
    var formatSummary: String  // 例：Best(1080p)/mp4 或 Audio/m4a
    var state: MockTaskState
    var progress: Double  // 0.0 ~ 1.0
    var speedText: String?  // 例：3.2 MB/s
    var etaText: String?  // 例：00:42
    var downloadedText: String?  // 例：42.1 / 85.0 MB
    var errorMessage: String?  // 失败时附带
}
