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

// 放到任意初始化早、且只注册一次的地方（比如 ContentView.onAppear 或 App.init）
final class NativeMessageReceiver: ObservableObject {
        static let shared = NativeMessageReceiver()
        @Published var lastPayload: [String: Any] = [:]

        private init() {
                DistributedNotificationCenter.default().addObserver(
                        forName: Notification.Name(
                                "com.tweetcat.nativeMessage.incoming"
                        ),
                        object: nil,
                        queue: .main
                ) { note in
                        if let payload = note.userInfo?["payload"]
                                as? [String: Any]
                        {
                                print("收到扩展消息:", payload)
                                self.lastPayload = payload
                        } else {
                                print("收到扩展消息但无 payload")
                        }
                }
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
