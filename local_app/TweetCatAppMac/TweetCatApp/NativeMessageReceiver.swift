import AppKit

private let kIncomingNote = Notification.Name(
        "com.tweetcat.nativeMessage.incoming"
)

// 放到任意初始化早、且只注册一次的地方（比如 ContentView.onAppear 或 App.init）
final class NativeMessageReceiver: ObservableObject {
        static let shared = NativeMessageReceiver()
        @Published var lastPayload: [String: Any] = [:]

        private init() {
                DistributedNotificationCenter.default().addObserver(
                        forName: kIncomingNote,
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
