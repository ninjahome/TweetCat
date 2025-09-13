//
//  DownloadState.swift
//  TweetCatApp
//
//  Created by wesley on 2025/9/12.
//

import Foundation
import SwiftUI

enum DownloadState: String, Codable {
    case queued, running, merging, done, failed, cancelled
}
struct DownloadTask: Identifiable, Codable {
    let id: String
    var videoId: String
    var title: String
    var formatSummary: String
    var pageTyp: String

    // 会被持久化
    var progress: Double
    var state: DownloadState
    var thumbURL: URL?
    var filepath: String?
    var updatedAt: Date

    // 不持久化
    var speedText: String
    var etaText: String
    var downloadedText: String
    var errorMessage: String?

    enum CodingKeys: String, CodingKey {
        case id, videoId, title, formatSummary, pageTyp
        case progress, state, thumbURL, filepath, updatedAt
    }

    init(
        id: String,
        videoId: String,
        title: String,
        formatSummary: String,
        pageTyp: String,
        progress: Double,
        speedText: String,
        etaText: String,
        downloadedText: String,
        state: DownloadState,
        errorMessage: String?,
        thumbURL: URL?,
        filepath: String?,
        updatedAt: Date
    ) {
        self.id = id
        self.videoId = videoId
        self.title = title
        self.formatSummary = formatSummary
        self.pageTyp = pageTyp
        self.progress = progress
        self.speedText = speedText
        self.etaText = etaText
        self.downloadedText = downloadedText
        self.state = state
        self.errorMessage = errorMessage
        self.thumbURL = thumbURL
        self.filepath = filepath
        self.updatedAt = updatedAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try c.decode(String.self, forKey: .id)
        self.videoId = try c.decode(String.self, forKey: .videoId)
        self.title = try c.decode(String.self, forKey: .title)
        self.formatSummary = try c.decode(String.self, forKey: .formatSummary)
        self.pageTyp =
            try c.decodeIfPresent(String.self, forKey: .pageTyp) ?? "watch"
        self.progress =
            try c.decodeIfPresent(Double.self, forKey: .progress) ?? 0.0
        self.state = try c.decode(DownloadState.self, forKey: .state)
        self.thumbURL = try c.decodeIfPresent(URL.self, forKey: .thumbURL)
        self.filepath = try c.decodeIfPresent(String.self, forKey: .filepath)
        self.updatedAt =
            try c.decodeIfPresent(Date.self, forKey: .updatedAt) ?? Date()
        self.speedText = ""
        self.etaText = ""
        self.downloadedText = ""
        self.errorMessage = nil
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(videoId, forKey: .videoId)
        try c.encode(title, forKey: .title)
        try c.encode(formatSummary, forKey: .formatSummary)
        try c.encode(pageTyp, forKey: .pageTyp)
        try c.encode(progress, forKey: .progress)
        try c.encode(state, forKey: .state)
        try c.encodeIfPresent(thumbURL, forKey: .thumbURL)
        try c.encodeIfPresent(filepath, forKey: .filepath)
        try c.encode(updatedAt, forKey: .updatedAt)
    }
}
