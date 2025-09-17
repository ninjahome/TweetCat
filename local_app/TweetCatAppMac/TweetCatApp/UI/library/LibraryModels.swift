//
//  LibraryCategory.swift
//  TweetCatApp
//
//  Created by wesley on 2025/9/10.
//

import Foundation

enum LibraryCategory: String, CaseIterable, Identifiable, Codable {
    case watch = "Watch"
    case shorts = "Shorts"
    var id: String { rawValue }
}

struct LibraryItem: Identifiable, Equatable, Codable {
    let id: UUID
    var title: String
    var videoId: String
    var thumbURL: URL?
    var fileName: String
    var fileSizeMB: Int
    var createdAt: Date
    var category: LibraryCategory

    init(
        id: UUID = UUID(),
        title: String,
        videoId: String,
        thumbURL: URL?,
        fileName: String,
        fileSizeMB: Int,
        createdAt: Date,
        category: LibraryCategory
    ) {
        self.id = id
        self.title = title
        self.videoId = videoId
        self.thumbURL = thumbURL
        self.fileName = fileName
        self.fileSizeMB = fileSizeMB
        self.createdAt = createdAt
        self.category = category
    }
}

enum LibrarySort: String, CaseIterable, Identifiable {
    case dateDesc = "下载时间（新→旧）"
    case dateAsc = "下载时间（旧→新）"
    case sizeDesc = "文件大小（大→小）"
    case sizeAsc = "文件大小（小→大）"
    case nameAsc = "名称（A→Z）"
    case nameDesc = "名称（Z→A）"

    var id: String { rawValue }
}
