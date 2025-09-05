import Foundation

enum NMErr: Error { case eof, invalidHeader, invalidJSON, tooLarge }

@inline(__always)
func readExact(_ n: Int, from h: FileHandle) throws -> Data {
        var out = Data()
        out.reserveCapacity(n)
        var left = n
        while left > 0 {
                if let chunk = try h.read(upToCount: left), !chunk.isEmpty {
                        out.append(chunk)
                        left -= chunk.count
                } else {
                        throw NMErr.eof
                }
        }
        return out
}

func readMessage(stdin: FileHandle) throws -> [String: Any] {
        let hdr = try readExact(4, from: stdin)
        let len = hdr.withUnsafeBytes { $0.load(as: UInt32.self) }.littleEndian
        if len > 50_000_000 { throw NMErr.tooLarge }
        let body = try readExact(Int(len), from: stdin)
        let any = try JSONSerialization.jsonObject(with: body, options: [])
        guard let obj = any as? [String: Any] else { throw NMErr.invalidJSON }
        return obj
}

func writeMessage(_ json: [String: Any], to out: FileHandle) throws {
        let data = try JSONSerialization.data(withJSONObject: json, options: [])
        var n = UInt32(data.count).littleEndian
        let hdr = withUnsafeBytes(of: &n) { Data($0) }
        out.write(hdr)
        out.write(data)
        try out.synchronize()
}

func run() {
        let stdin = FileHandle.standardInput
        let stdout = FileHandle.standardOutput
        do {
                // 1) 读浏览器扩展消息
                let req = try readMessage(stdin: stdin)

                // 2) 转发给 UI App
                DistributedNotificationCenter.default().post(
                        name: Notification.Name(
                                "com.tweetcat.nativeMessage.incoming"
                        ),
                        object: nil,
                        userInfo: ["payload": req]
                )

                // 3) 回一个伪造响应
                let fakeItems: [[String: Any]] = [
                        [
                                "label": "720p AVC + m4a（mock）",
                                "value": "best[height<=720]", "height": 720,
                                "kind": "progressive",
                        ],
                        [
                                "label": "1080p (video-only, mock)",
                                "value": "bestvideo[height<=1080]+bestaudio",
                                "height": 1080, "kind": "merge",
                        ],
                ]
                let resp: [String: Any] = [
                        "ok": true,
                        "message": "received & forwarded to TweetCatApp",
                        "formats": ["items": fakeItems],
                        "echo": req,
                ]
                try writeMessage(resp, to: stdout)
                exit(0)
        } catch NMErr.eof {
                exit(0)
        } catch {
                try? writeMessage(
                        ["ok": false, "error": "\(error)"],
                        to: stdout
                )
                exit(1)
        }
}

// 顶层入口：**不要有 @main**，直接调用
run()
