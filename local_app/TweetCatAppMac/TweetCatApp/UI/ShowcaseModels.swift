//
//  UIVideoCandidate.swift
//  TweetCatApp
//
//  Created by wesley on 2025/9/10.
//

import Foundation

// 展示页的候选视频（来自扩展消息；当前用假数据）
struct UIVideoCandidate: Identifiable, Equatable {
    let id = UUID()
    let title: String
    let videoId: String
    let thumbnailURL: URL?
    let sourceURL: URL?
    let durationSec: Int?
}

// 格式选项（yt-dlp -F 的最小 UI 版；当前用假数据）
struct UIFormatOption: Identifiable, Equatable {
    let id = UUID()
    let kind: Kind
    let resolution: String
    let container: String
    let estSizeMB: Int?
    let note: String?

    enum Kind: String {
        case merged = "合并"
        case video = "视频"
        case audio = "音频"
    }
}

// 假数据工厂
enum ShowcaseMock {
    static let candidate1 = UIVideoCandidate(
        title: "SwiftUI x yt-dlp：下载器 Demo",
        videoId: "abc123xyz",
        thumbnailURL: URL(
            string: "https://via.placeholder.com/640x360.png?text=Thumbnail"
        ),
        sourceURL: URL(string: "https://www.youtube.com/watch?v=abc123xyz"),
        durationSec: 312
    )

    static let candidate2 = UIVideoCandidate(
        title: "Shorts：极简 30 秒演示",
        videoId: "shorts-001",
        thumbnailURL: URL(
            string: "https://via.placeholder.com/640x360.png?text=Shorts"
        ),
        sourceURL: URL(string: "https://www.youtube.com/shorts/shorts-001"),
        durationSec: 30
    )

    static let formatsFor1: [UIFormatOption] = [
        .init(
            kind: .merged,
            resolution: "Best (1080p)",
            container: "mp4",
            estSizeMB: 85,
            note: "推荐"
        ),
        .init(
            kind: .video,
            resolution: "1080p / 30fps",
            container: "mp4",
            estSizeMB: 70,
            note: "H.264"
        ),
        .init(
            kind: .video,
            resolution: "720p / 30fps",
            container: "mp4",
            estSizeMB: 45,
            note: "H.264"
        ),
        .init(
            kind: .audio,
            resolution: "Audio only",
            container: "m4a",
            estSizeMB: 8,
            note: "AAC"
        ),
    ]

    static let formatsFor2: [UIFormatOption] = [
        .init(
            kind: .merged,
            resolution: "Best",
            container: "mp4",
            estSizeMB: 10,
            note: "Shorts"
        ),
        .init(
            kind: .audio,
            resolution: "Audio only",
            container: "m4a",
            estSizeMB: 1,
            note: "AAC"
        ),
    ]
}
