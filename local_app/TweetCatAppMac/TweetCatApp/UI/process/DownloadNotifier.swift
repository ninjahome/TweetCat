import Foundation
import UserNotifications

final class DownloadNotifier {
    static let shared = DownloadNotifier()

    private init() {}

    // MARK: - 初始化时调用
    func requestAuthorization() {
        let center = UNUserNotificationCenter.current()
        center.requestAuthorization(options: [.alert, .sound, .badge]) {
            granted,
            error in
            if granted {
                print("✅ 通知权限已授权")
            } else {
                print("⚠️ 通知权限未授权: \(error?.localizedDescription ?? "用户拒绝")")
            }
        }
    }

    /// 下载成功时调用
    func notifySuccess(title: String = "下载完成", message: String = "视频已成功下载") {
        let config = AppConfigManager.shared.load()

        if config.notifyDone {
            SoundPlayer.shared.playSuccess()
            sendNotification(title: title, body: message)
        }
    }

    /// 下载失败时调用
    func notifyFail(title: String = "下载失败", message: String = "请检查网络或代理配置") {
        let config = AppConfigManager.shared.load()

        if config.notifyFail {
            SoundPlayer.shared.playFail()
            sendNotification(title: title, body: message)
        }
    }

    // MARK: - 发送系统通知
    private func sendNotification(title: String, body: String) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = UNNotificationSound.default

        let request = UNNotificationRequest(
            identifier: UUID().uuidString,
            content: content,
            trigger: nil  // 立即显示
        )

        UNUserNotificationCenter.current().add(
            request,
            withCompletionHandler: nil
        )
    }
}
