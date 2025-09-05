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

// 简单桥接：接收 Host Helper 转来的消息
enum NativeMessageBridge {
        static let notificationName = Notification.Name(
                "com.tweetcat.nativeMessage.incoming"
        )

        static func startObserving() {
                DistributedNotificationCenter.default().addObserver(
                        forName: notificationName,
                        object: nil,
                        queue: .main
                ) { note in
                        // Host Helper 发来的 payload（来自浏览器扩展）
                        if let payload = note.userInfo?["payload"]
                                as? [String: Any]
                        {
                                // 你可以在这里接管业务：例如更新 UI / 入库 / 触发下载
                                print("收到扩展消息：", payload)
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
                                        NativeMessageBridge.startObserving()

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
