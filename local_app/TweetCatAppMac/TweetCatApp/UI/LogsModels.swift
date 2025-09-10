//
//  LogSource.swift
//  TweetCatApp
//
//  Created by wesley on 2025/9/10.
//

import Foundation

enum LogSource: String, CaseIterable, Identifiable {
    case host = "host"
    case ui = "ui"
    case ytdlp = "yt-dlp"
    var id: String { rawValue }
}

enum LogLevel: String, CaseIterable, Identifiable {
    case info = "info"
    case warn = "warn"
    case error = "error"
    var id: String { rawValue }
}

struct LogLine: Identifiable, Equatable {
    let id = UUID()
    let time: Date
    let source: LogSource
    let level: LogLevel
    let message: String
    let taskId: String?
}
