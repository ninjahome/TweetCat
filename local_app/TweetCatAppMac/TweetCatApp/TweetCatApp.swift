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

    init() {
        YTDLPManager.shared.start()
        _ = NativeMessageReceiver.shared
        ManifestInstaller.ensureChromeManifestInstalled()
    }

    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    var body: some Scene {
        WindowGroup {
            SidebarView()
        }
    }
}
