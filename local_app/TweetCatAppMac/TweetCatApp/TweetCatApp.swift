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

func quickProxyCheck(proxyEnv: [String: String]) {
        do {
                let (code, _, err) = try Subprocess.runStreamed(
                        executableURL: URL(fileURLWithPath: "/usr/bin/curl"),
                        arguments: [
                                "-s", "--max-time", "10",
                                "https://ipinfo.io/ip",
                        ],
                        proxyEnv: proxyEnv,
                        timeoutSec: 15,
                        onStdoutLine: { print("[curl] \($0)") },
                        onStderrLine: { _ in }
                )
                print("[curl] exit=\(code) err=\(err)")
        } catch {
                print("[curl] failed: \(error)")
        }
}

@main
struct TweetCatApp: App {

        init() {
                quickProxyCheck(proxyEnv: ProxyConfig.vpn2)
                YTDLPManager.shared.start()
                _ = NativeMessageReceiver.shared
                ManifestInstaller.ensureChromeManifestInstalled()
        }

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

        var body: some Scene {
                WindowGroup {
                        ContentView()
                }
                .modelContainer(sharedModelContainer)
        }
}
