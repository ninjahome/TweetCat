import AppKit

// 放到任意初始化早、且只注册一次的地方（比如 ContentView.onAppear 或 App.init）
final class NativeMessageReceiver: ObservableObject {
    static let shared = NativeMessageReceiver()

    @Published private(set) var items: [TweetCatItem] = []
    @Published private(set) var latestCandidate: UIVideoCandidate? = nil

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
        guard let payload = note.userInfo?["payload"] as? [String: Any] else {
            print("收到扩展消息但无 payload")
            return
        }
        print("收到扩展消息:", payload)
    }

    private func gotVideoMeta(_ note: Notification) {
        guard let meta = note.userInfo?["payload"] as? [String: Any] else {
            print("收到视频元数据但无 meta")
            return
        }

        print("收到扩展消息:", meta)

        // 允许兼容旧键名，优先用新格式
        let title: String = (meta["title"] as? String) ?? "(未命名)"
        let vid: String =
            (meta["videoID"] as? String)
            ?? (meta["videoId"] as? String)
            ?? ""
        // 新字段：watch/shorts
        let pageTyp: String = (meta["videoTyp"] as? String) ?? "watch"

        // 选缩略图（新：thumbs[]；旧：thumbnail）
        let thumbURL: URL? =
            bestThumbURL(from: meta)
            ?? (meta["thumbnail"] as? String).flatMap(URL.init(string:))

        // 构造来源 URL（新结构没有直接给 url）
        let sourceURL: URL? = {
            guard !vid.isEmpty else { return nil }
            if pageTyp.lowercased() == "shorts" {
                return URL(string: "https://www.youtube.com/shorts/\(vid)")
            } else {
                return URL(string: "https://www.youtube.com/watch?v=\(vid)")
            }
        }()

        // 时长：新是 number（秒）
        let durationSec: Int? = {
            if let n = meta["duration"] as? NSNumber { return n.intValue }
            if let d = meta["duration"] as? Int { return d }
            return (meta["duration"] as? Double).map { Int($0) }
        }()

        let ui = UIVideoCandidate(
            title: title,
            videoId: vid,
            thumbnailURL: thumbURL,
            sourceURL: sourceURL,
            durationSec: durationSec
        )

        DispatchQueue.main.async {
            self.latestCandidate = ui
        }
    }

    /// 从 payload 的 thumbs 数组里挑选分辨率最大的 url
    private func bestThumbURL(from meta: [String: Any]) -> URL? {
        guard let arr = meta["thumbs"] as? [[String: Any]], !arr.isEmpty else {
            return nil
        }
        // 以 width*height 最大为准；若缺字段，则回退到第一个
        let best =
            arr.max { lhs, rhs in
                let lw = (lhs["width"] as? NSNumber)?.doubleValue ?? 0
                let lh = (lhs["height"] as? NSNumber)?.doubleValue ?? 0
                let rw = (rhs["width"] as? NSNumber)?.doubleValue ?? 0
                let rh = (rhs["height"] as? NSNumber)?.doubleValue ?? 0
                return (lw * lh) < (rw * rh)
            } ?? arr[0]
        if let s = best["url"] as? String { return URL(string: s) }
        return nil
    }

}
