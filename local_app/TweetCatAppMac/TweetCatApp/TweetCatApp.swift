import Foundation
import SwiftData
import SwiftUI

class AppDelegate: NSObject, NSApplicationDelegate {
        func applicationShouldTerminateAfterLastWindowClosed(
                _ sender: NSApplication
        ) -> Bool {
                return true  // 关闭最后一个窗口时退出应用
        }
}

@main
struct TweetCatApp: App {
        @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
        var sharedModelContainer: ModelContainer = {
                let schema = Schema([
                        Item.self
                ])
                let modelConfiguration = ModelConfiguration(
                        schema: schema,
                        isStoredInMemoryOnly: false
                )

                do {
                        return try ModelContainer(
                                for: schema,
                                configurations: [modelConfiguration]
                        )
                } catch {
                        fatalError("Could not create ModelContainer: \(error)")
                }
        }()

        @State private var didRunStartupTask = false

        var body: some Scene {
                WindowGroup {
                        ContentView()
                                .onAppear {
                                        // ✅ 开始监听原生消息（Host Helper 会转发到这里）
                                        _ = NativeMessageReceiver.shared

                                        ManifestInstaller
                                                .ensureChromeManifestInstalled()
                                        // 你原来的启动逻辑保留
                                        guard !didRunStartupTask else { return }
                                        didRunStartupTask = true
                                        DispatchQueue.global(qos: .utility)
                                                .async {
                                                        YTDLP.printVersion()
                                                }
                                }
                }
                .modelContainer(sharedModelContainer)
        }
}
