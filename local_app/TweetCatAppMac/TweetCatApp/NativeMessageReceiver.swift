import AppKit

private let kIncomingNote = Notification.Name(
        "com.tweetcat.nativeMessage.incoming"
)

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
                // 期望字段（见你提供的 2.txt）
                // ["action": "cookie", "url": "...", "cookies": [[...]], "videoId": "1SLgftq3jZw"]
                let action = payload["action"] as? String ?? ""
                guard action == "cookie" else {
                        NSLog("忽略 action=\(action)")
                        return
                }

                let url = payload["url"] as? String ?? ""
                let videoId = payload["videoId"] as? String ?? ""

                guard !videoId.isEmpty else {
                        NSLog("缺少 videoId，跳过写文件")
                        return
                }

                let cookies = payload["cookies"] as? [[String: Any]] ?? []
                do {
                        let fileURL = try CookieNetscapeWriter.shared
                                .writeNetscapeFile(
                                        cookies: cookies,
                                        videoId: videoId
                                )
                        NSLog("Netscape cookies 写入成功: \(fileURL.path)")

                        // 记录对象到数组中
                        let item = TweetCatItem(
                                videoId: videoId,
                                url: url,
                                createdAt: Date()
                        )
                        self.items.insert(item, at: 0)
                        
                        YTDLP.queryInfo(videoId: videoId, url: url)

                } catch {
                        NSLog(
                                "写 Netscape cookies 失败: \(error.localizedDescription)"
                        )
                }
                
                
        }
}
