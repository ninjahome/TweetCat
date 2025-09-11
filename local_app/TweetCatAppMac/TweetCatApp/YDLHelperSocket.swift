import Foundation
import Network

final class YDLHelperSocket {
    static let shared = YDLHelperSocket()
    private init() {}

    private var process: Process?
    private var connection: NWConnection?

    // MARK: - Public

    func startIfNeeded() {
        if process?.isRunning == true { return }
        guard
            let binURL = Bundle.main.url(
                forResource: "tweetcat_ydl_server",
                withExtension: nil
            )
        else {
            NSLog("YDLHelperSocket: server not found in bundle")
            return
        }

        let p = Process()
        p.executableURL = binURL
        p.qualityOfService = .userInitiated
        p.terminationHandler = { proc in
            NSLog(
                "YDLHelperSocket: server terminated (status=\(proc.terminationStatus))"
            )
        }

        do {
            try p.run()
            process = p
            NSLog("YDLHelperSocket: server started pid=\(p.processIdentifier)")
        } catch {
            NSLog(
                "YDLHelperSocket: failed to run server: \(error.localizedDescription)"
            )
        }
    }

    func stop() {
        connection?.cancel()
        connection = nil
        process?.terminate()
        process = nil
        NSLog("YDLHelperSocket: stopped")
    }

    @discardableResult
    func requestLine(_ line: String, timeout: TimeInterval = 15.0) -> String? {
        startIfNeeded()

        // 确保已连接
        guard ensureConnected(timeout: max(1.0, timeout * 0.5)) else {
            NSLog("YDLHelperSocket: not connected")
            return nil
        }
        guard let conn = connection else { return nil }

        let payload = (line + "\n").data(using: .utf8)!
        let t0 = Date()
        NSLog("YDLHelperSocket: send cmd=\(line) at \(t0)")

        // 发送
        let sendSema = DispatchSemaphore(value: 0)
        conn.send(
            content: payload,
            completion: .contentProcessed { err in
                if let err = err {
                    NSLog("YDLHelperSocket: send error: \(err)")
                }
                sendSema.signal()
            }
        )
        _ = sendSema.wait(timeout: .now() + timeout)

        // 逐块接收直到遇到换行或者超时
        let recvSema = DispatchSemaphore(value: 0)
        var buffer = Data()

        func recvOnce() {
            conn.receive(minimumIncompleteLength: 1, maximumLength: 16 * 1024) {
                data,
                _,
                _,
                err in
                if let err = err {
                    NSLog("YDLHelperSocket: recv error: \(err)")
                    recvSema.signal()
                    return
                }
                if let d = data, !d.isEmpty {
                    buffer.append(d)
                    // 协议是“单行 JSON”，以换行结尾
                    if buffer.last == 0x0A {  // '\n'
                        recvSema.signal()
                        return
                    }
                    // 继续收
                    recvOnce()
                    return
                }
                // 连接对端没再给数据了
                recvSema.signal()
            }
        }

        recvOnce()
        let waitRes = recvSema.wait(timeout: .now() + timeout)
        if waitRes == .timedOut {
            NSLog(
                "YDLHelperSocket: request timeout after \(timeout)s, cmd=\(line)"
            )
            return nil
        }

        // 去掉末尾换行，转成字符串
        if buffer.last == 0x0A { buffer.removeLast() }
        let t1 = Date()
        NSLog(
            "YDLHelperSocket: recv at \(t1), elapsed=\(Int(t1.timeIntervalSince(t0)*1000))ms"
        )
        NSLog("YDLHelperSocket: recv bytes=\(buffer.count)")

        let result = String(data: buffer, encoding: .utf8)
        NSLog("YDLHelperSocket: result(raw)=\(result ?? "<decode-failed>")")
        return result
    }

    func versionTest(timeout: TimeInterval = 5.0) {
        startIfNeeded()
        if let data = try? JSONSerialization.data(
            withJSONObject: ["cmd": "version"],
            options: []
        ),
            let line = String(data: data, encoding: .utf8)
        {
            NSLog("versionTest called at \(Date())")
            if let result = requestLine(line, timeout: timeout) {
                print("YDLHelperSocket raw result:", result)
            }
        }
    }

    // MARK: - Private

    private func ensureConnected(timeout: TimeInterval) -> Bool {
        if let conn = connection {
            switch conn.state {
            case .ready: return true
            case .cancelled, .failed: break  // will recreate below
            default:  // try to wait a bit
                let sema = DispatchSemaphore(value: 0)
                var ok = false
                let old = conn.stateUpdateHandler
                conn.stateUpdateHandler = { st in
                    if case .ready = st {
                        ok = true
                        sema.signal()
                    }
                    if case .failed = st { sema.signal() }
                    if case .cancelled = st { sema.signal() }
                    old?(st)
                }
                _ = sema.wait(timeout: .now() + timeout)
                if ok { return true }
            }
            // recreate
            conn.cancel()
            connection = nil
        }

        // create a fresh connection and wait until ready (or timeout)
        let host = NWEndpoint.Host("127.0.0.1")
        let port = NWEndpoint.Port(rawValue: 54321)!
        let conn = NWConnection(host: host, port: port, using: .tcp)
        let sema = DispatchSemaphore(value: 0)
        var ok = false
        conn.stateUpdateHandler = { st in
            if case .ready = st {
                ok = true
                sema.signal()
            }
            if case .failed = st { sema.signal() }
            if case .cancelled = st { sema.signal() }
        }
        conn.start(queue: .global())
        _ = sema.wait(timeout: .now() + timeout)
        if ok {
            connection = conn
            NSLog("YDLHelperSocket connection state: ready")
            return true
        } else {
            conn.cancel()
            NSLog("YDLHelperSocket connection state: waiting (not ready)")
            return false
        }
    }
    private static var infoCache: [String: YTDLP.YTDLPInfo] = [:]
    func fetchVideoInfo(
        videoID: String,
        cookiesFile: String,
        proxy: String?,  // 可选
        timeout: TimeInterval = 15.0
    ) -> YTDLP.YTDLPInfo? {

        // 1. 先查缓存
        if let cached = YDLHelperSocket.infoCache[videoID] {
            NSLog("fetchVideoInfo: hit cache for \(videoID)")
            return cached
        }
        startIfNeeded()

        let url = "https://www.youtube.com/watch?v=\(videoID)"
        var payload: [String: String] = [
            "cmd": "json",
            "url": url,
            "cookies": cookiesFile,
        ]
        if let proxy = proxy, !proxy.isEmpty {
            payload["proxy"] = proxy
        }

        // 编码发送行
        guard
            let data = try? JSONSerialization.data(
                withJSONObject: payload,
                options: []
            ),
            let line = String(data: data, encoding: .utf8)
        else {
            NSLog("fetchVideoInfo: failed to encode payload")
            return nil
        }

        // 发请求 -> 收字符串
        guard let result = requestLine(line, timeout: timeout) else {
            NSLog("fetchVideoInfo: requestLine returned nil")
            return nil
        }

        // 先尝试直接解码
        if let info = YTDLP.decodeYTDLPInfo(from: Data(result.utf8)) {
            YDLHelperSocket.infoCache[videoID] = info
            return info  // 直接返回 YTDLPInfo
        }

        // 兜底：如果有杂质，提取第一段顶层 JSON 再解
        if let firstJSON = YTDLP.extractTopLevelJSONObjects(from: result).first,
            let info = YTDLP.decodeYTDLPInfo(from: Data(firstJSON.utf8))
        {
            YDLHelperSocket.infoCache[videoID] = info
            return info
        }

        NSLog("fetchVideoInfo: failed to decode YTDLPInfo")
        return nil
    }

}
