//
//  AppState.swift
//  TweetCatApp
//
//  Created by wesley on 2025/9/10.
//

import Combine
import Foundation

final class AppState: ObservableObject {
    /// 当前选中的侧边栏标签
    @Published var selectedTab: AppTab = .showcase

    // 预留共享状态（后续步骤会逐步接入）
    @Published var hasExtensionMessage: Bool = false
}
