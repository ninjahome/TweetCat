//
//  AppTab.swift
//  TweetCatApp
//
//  Created by wesley on 2025/9/10.
//

import Foundation

enum AppTab: String, CaseIterable, Identifiable {
    case showcase = "展示"
    case progress = "进度"
    case library = "已下载"
    case settings = "设置"
    case logs = "日志"  // 放在最底部

    var id: String { rawValue }
}
