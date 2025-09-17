import Foundation
import SwiftData
import SwiftUI

class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationShouldTerminateAfterLastWindowClosed(
        _ sender: NSApplication
    ) -> Bool {
        return true  // 关闭最后一个窗口时退出应用
    }

    // 例如在 AppDelegate 或你的启动入口里
    func applicationDidFinishLaunching(_ notification: Notification) {
        // 假设你已有常量 kTweetCatCookieFile
        YDLHelperSocket.shared.startIfNeeded()
    }

    func applicationWillTerminate(_ aNotification: Notification) {
        // 退出时一定要停
        YDLHelperSocket.shared.stop()
    }

}

@main
struct TweetCatApp: App {
    @StateObject private var appState = AppState()
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    init() {
        signal(SIGPIPE, SIG_IGN)
        _ = NativeMessageReceiver.shared
        ManifestInstaller.ensureChromeManifestInstalled()
        DownloadNotifier.shared.requestAuthorization()
    }

    var body: some Scene {
        WindowGroup {
            ZStack {
                SidebarView()
                    .environmentObject(appState)
                    .onAppear {
                        DownloadCenter.shared.appState = appState
                        DownloadCenter.shared.loadActive()
                        LibraryCenter.shared.load()
                    }

                WaitOverlay()
                GlobalAlertView()
            }
        }
    }
}
