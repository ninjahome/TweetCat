import AppKit

// 放到任意初始化早、且只注册一次的地方（比如 ContentView.onAppear 或 App.init）
final class NativeMessageReceiver: ObservableObject {
        static let shared = NativeMessageReceiver()
        @Published var lastPayload: [String: Any] = [:]

        // 新增：累积放对象
        @Published private(set) var items: [TweetCatItem] = []

        private init() {
                DistributedNotificationCenter.default().addObserver(
                        forName: kIncomingNote,
                        object: nil,
                        queue: .main
                ) { [weak self] note in
                        guard let self else { return }
                        if let payload = note.userInfo?["payload"]
                                as? [String: Any]
                        {
                                print("收到扩展消息:", payload)
                                self.lastPayload = payload
                                self.processPayload(payload)
                        } else {
                                print("收到扩展消息但无 payload")
                        }
                }
        }

        /// 把收到的 payload 落成 Netscape cookie 文件，并记录一个 TweetCatItem
        private func processPayload(_ payload: [String: Any]) {
                NSLog("ui APP got payload:", payload)
        }
}
