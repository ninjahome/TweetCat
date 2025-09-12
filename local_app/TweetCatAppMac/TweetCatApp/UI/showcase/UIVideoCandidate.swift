//
//  UIVideoCandidate.swift
//  TweetCatApp
//
//  Created by wesley on 2025/9/12.
//

import Foundation

// 展示页的候选视频
struct UIVideoCandidate: Identifiable, Equatable {
    let id = UUID()
    let title: String
    let videoId: String
    let thumbnailURL: URL?
    let sourceURL: URL?
    let durationSec: Int?
    let pageTyp: String  // "watch" / "shorts"
}
