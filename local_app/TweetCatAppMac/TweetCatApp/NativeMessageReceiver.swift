import AppKit

// 放到任意初始化早、且只注册一次的地方（比如 ContentView.onAppear 或 App.init）
final class NativeMessageReceiver: ObservableObject {
        static let shared = NativeMessageReceiver()

        @Published private(set) var items: [TweetCatItem] = []

        private init() {
                DistributedNotificationCenter.default().addObserver(
                        forName: kIncomingNote,
                        object: nil,
                        queue: nil
                ) { [weak self] note in
                        print("---------------------->>>>kIncomingNote:")
                        guard let self = self else { return }
                        self.commonIncomingMsg(note)
                }

                DistributedNotificationCenter.default().addObserver(
                        forName: kGotVideoMeta,
                        object: nil,
                        queue: nil
                ) { [weak self] note in
                        print("---------------------->>>>kGotVideoMeta:")
                        guard let self = self else { return }
                        self.gotVideoMeta(note)
                }
        }

        private func commonIncomingMsg(_ note: Notification) {
                if let payload = note.userInfo?["payload"] as? [String: Any] {
                        print("收到扩展消息:", payload)
                } else {
                        print("收到扩展消息但无 payload")
                }
        }

        private func gotVideoMeta(_ note: Notification) {
                if let meta = note.userInfo?["payload"] as? [String: Any] {
                        print("收到视频元数据:", meta)
                } else {
                        print("收到视频元数据但无 meta")
                }
        }
}
