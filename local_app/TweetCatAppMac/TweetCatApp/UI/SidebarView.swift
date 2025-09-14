import Combine
import Foundation
import SwiftUI

final class AppState: ObservableObject {
    /// 当前选中的侧边栏标签（可选，符合 NavigationSplitView 的 API）
    @Published var selectedTab: AppTab? = .showcase
    @Published var hasExtensionMessage: Bool = false
}

enum AppTab: String, CaseIterable, Identifiable {
    case showcase = "展示"
    case progress = "进度"
    case library = "已下载"
    case settings = "设置"
    case logs = "日志"

    var id: String { rawValue }
}

struct SidebarView: View {
    @State private var selectedTab: AppTab? = .showcase  // ✅ 本地状态

    var body: some View {
        NavigationSplitView {
            List(selection: $selectedTab) {
                NavigationLink(value: AppTab.showcase) {
                    Label("展示", systemImage: "rectangle.stack.person.crop")
                }
                NavigationLink(value: AppTab.progress) {
                    Label("进度", systemImage: "arrow.down.circle")
                }
                NavigationLink(value: AppTab.library) {
                    Label("已下载", systemImage: "film.stack")
                }
                NavigationLink(value: AppTab.settings) {
                    Label("设置", systemImage: "gearshape")
                }
                NavigationLink(value: AppTab.logs) {
                    Label("日志", systemImage: "doc.text.magnifyingglass")
                }
            }
            .listStyle(.sidebar)
            .navigationTitle("TweetCat")
        } detail: {
            if let selected = selectedTab {
                DetailRouterView(selectedTab: selected)
            } else {
                Text("请选择一个功能")
                    .foregroundStyle(.secondary)
            }
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

// 预览
#Preview {
    SidebarView()
        .environmentObject(AppState())
}
