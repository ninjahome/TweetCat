//
//  SidebarView.swift
//  TweetCatApp
//
//  Created by wesley on 2025/9/10.
//

import SwiftUI

struct SidebarView: View {
    @StateObject private var appState = AppState()

    var body: some View {
        NavigationSplitView {
            List(selection: $appState.selectedTab) {
                // 主功能区
                Section {
                    NavigationLink(value: AppTab.showcase) {
                        Label("展示", systemImage: "rectangle.stack.person.crop")  // 接收扩展消息
                    }
                    NavigationLink(value: AppTab.progress) {
                        Label("进度", systemImage: "arrow.down.circle")  // 下载进度
                    }
                    NavigationLink(value: AppTab.library) {
                        Label("已下载", systemImage: "film.stack")  // Watch / Shorts
                    }
                    NavigationLink(value: AppTab.settings) {
                        Label("设置", systemImage: "gearshape")  // VPN 等
                    }
                }

                // 最不重要：日志（置底）
                Section {
                    NavigationLink(value: AppTab.logs) {
                        Label("日志", systemImage: "doc.text.magnifyingglass")
                    }
                } footer: {
                    // 可选：小提示或版本号
                    Text("TweetCat V1 • UI 原型").font(.footnote).foregroundStyle(
                        .secondary
                    )
                }
            }
            .listStyle(.sidebar)
            .navigationTitle("TweetCat")
        } detail: {
            DetailRouterView(selectedTab: appState.selectedTab)
                .environmentObject(appState)
        }
    }
}

private struct DetailRouterView: View {
    let selectedTab: AppTab

    var body: some View {
        switch selectedTab {
        case .showcase: ShowcaseView()
        case .progress: ProgressViewTC()
        case .library: LibraryView()
        case .settings: SettingsViewTC()
        case .logs: LogsViewTC()
        }
    }
}

// 预览（仅开发期）
#Preview {
    SidebarView()
}
