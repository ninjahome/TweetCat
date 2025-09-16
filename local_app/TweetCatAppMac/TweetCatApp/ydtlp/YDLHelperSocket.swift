import Foundation
import Network

final class YDLHelperSocket {
    static let shared = YDLHelperSocket()
    let controlPort = UInt16(54320)
    let streamPort = UInt16(54321)
    public private(set) var serverReady: Bool = false

    private init() {}

    private var process: Process?
    private var connection: NWConnection?

    // MARK: - Start & readiness

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

        // 将 App Bundle 的 Resources 目录前置到 PATH，供后端进程找到 ffmpeg / ffprobe
        var env = ProcessInfo.processInfo.environment
        let resourcesDir = binURL.deletingLastPathComponent().path
        let currentPATH = env["PATH"] ?? "/usr/bin:/bin:/usr/sbin:/sbin"
        env["PATH"] = "\(resourcesDir):\(currentPATH)"

        // ✅ 固定 PyInstaller runtime 解压目录
        let runtimeDir = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(
                "Library/Application Support/TweetCat/runtime",
                isDirectory: true
            )

        // 确保目录存在
        try? FileManager.default.createDirectory(
            at: runtimeDir,
            withIntermediateDirectories: true
        )

        // 调用 Subprocess 清理隔离属性
        do {
            _ = try Subprocess.run(
                executableURL: URL(fileURLWithPath: "/usr/bin/xattr"),
                arguments: ["-dr", "com.apple.quarantine", runtimeDir.path]
            )
            NSLog(
                "YDLHelperSocket: cleared quarantine attributes for runtimeDir"
            )
        } catch {
            NSLog(
                "YDLHelperSocket: xattr failed: \(error.localizedDescription)"
            )
        }

        // 设置环境变量，让 PyInstaller 解压到固定目录
        env["PYINSTALLER_TEMP"] = runtimeDir.path

        p.environment = env

        NSLog("YDLHelperSocket: PATH=\(env["PATH"] ?? "<nil>")")
        NSLog("YDLHelperSocket: resourcesDir=\(resourcesDir)")
        NSLog("YDLHelperSocket: PYINSTALLER_TEMP=\(env["PYINSTALLER_TEMP"] ?? "<nil>")")

        do {
            try p.run()
            process = p
            scheduleReadyProbe(delay: 5.0, timeout: 20.0)
            NSLog("YDLHelperSocket: server started pid=\(p.processIdentifier)")
        } catch {
            NSLog(
                "YDLHelperSocket: failed to run server: \(error.localizedDescription)"
            )
            return
        }
    }

    /// 异步调度：先延迟 `delay` 秒，再做阻塞式端口探测；成功则置 serverReady = true。
    func scheduleReadyProbe(
        delay: TimeInterval = 5.0,
        timeout: TimeInterval = 20.0
    ) {
        // 先标记为未就绪，避免旧状态误导
        serverReady = false
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else { return }
            Thread.sleep(forTimeInterval: delay)
            let ok = self.blockingProbeReady(timeout: timeout)
            DispatchQueue.main.async { self.serverReady = ok }
        }
    }

    /// 阻塞式探测：控制端必须能 version 往返；下载端 TCP 必须可连。
    private func blockingProbeReady(timeout: TimeInterval) -> Bool {
        let start = Date()
        var ctrlOK = false
        var strmOK = false

        while Date().timeIntervalSince(start) < timeout {
            if !ctrlOK { ctrlOK = probeControlReady(timeout: 1.0) }
            if !strmOK {
                strmOK = probePortReady(port: streamPort, timeout: 1.0)
            }
            if ctrlOK && strmOK {
                NSLog("YDLHelperSocket: server ready (control & stream up)")
                return true
            }
            Thread.sleep(forTimeInterval: 0.2)
        }

        NSLog(
            "YDLHelperSocket: waitForServerReady timeout (control=\(ctrlOK), stream=\(strmOK))"
        )
        return false
    }

    // MARK: - Readiness probes

    /// 探测控制通道是否就绪：连 controlPort，发送 {"cmd":"version"} 并等待一行 JSON（含 "version"）
    private func probeControlReady(timeout: TimeInterval) -> Bool {
        let host = NWEndpoint.Host("127.0.0.1")
        guard let port = NWEndpoint.Port(rawValue: controlPort) else {
            return false
        }
        let conn = NWConnection(host: host, port: port, using: .tcp)

        let sema = DispatchSemaphore(value: 0)
        var ready = false
        conn.stateUpdateHandler = { st in
            if case .ready = st {
                ready = true
                sema.signal()
            }
            if case .failed = st { sema.signal() }
            if case .cancelled = st { sema.signal() }
        }
        conn.start(queue: .global())

        if sema.wait(timeout: .now() + timeout) != .success || !ready {
            conn.cancel()
            return false
        }

        // 发 version
        let payload = #"{"cmd":"version"}"#.data(using: .utf8)!
        let sendSema = DispatchSemaphore(value: 0)
        conn.send(
            content: payload + Data([0x0A]),
            completion: .contentProcessed { _ in sendSema.signal() }
        )
        _ = sendSema.wait(timeout: .now() + timeout)

        // 收一行
        let recvSema = DispatchSemaphore(value: 0)
        var ok = false
        var buffer = Data()
        func recvLoop() {
            conn.receive(minimumIncompleteLength: 1, maximumLength: 16 * 1024) {
                data,
                _,
                _,
                err in
                if err != nil {
                    recvSema.signal()
                    return
                }
                if let d = data, !d.isEmpty {
                    buffer.append(d)
                    if let nl = buffer.firstIndex(of: 0x0A) {
                        let line = buffer[..<nl]
                        if let s = String(data: line, encoding: .utf8),
                            let obj = try? JSONSerialization.jsonObject(
                                with: Data(s.utf8)
                            ) as? [String: Any],
                            (obj["ok"] as? Bool) == true,
                            obj["version"] != nil
                        {
                            ok = true
                        }
                        recvSema.signal()
                        return
                    }
                    recvLoop()
                    return
                }
                recvSema.signal()
            }
        }
        recvLoop()
        _ = recvSema.wait(timeout: .now() + timeout)
        conn.cancel()
        return ok
    }

    /// 探测任意端口的 TCP 就绪（用于 streamPort）
    private func probePortReady(port: UInt16, timeout: TimeInterval) -> Bool {
        let host = NWEndpoint.Host("127.0.0.1")
        guard let p = NWEndpoint.Port(rawValue: port) else { return false }
        let conn = NWConnection(host: host, port: p, using: .tcp)
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
        conn.cancel()
        return ok
    }

    func stop() {
        connection?.cancel()
        connection = nil
        process?.terminate()
        process = nil
        serverReady = false
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
        NSLog("YDLHelperSocket: send cmd=%@ at %@", line, "\(t0)")

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
        NSLog("YDLHelperSocket: result(raw)=%@", result ?? "<decode-failed>")
        return result
    }

    @discardableResult
    func requestStream(
        _ line: String,
        timeout: TimeInterval = 15.0,
        stopWhen: ((String) -> Bool)? = nil,
        onEvent: @escaping (String) -> Void,
        onClose: @escaping (Result<Void, Error>) -> Void
    ) -> () -> Void {

        // 1) 确保后端进程已起（与现有 requestLine 一致）
        startIfNeeded()

        // 2) 针对“下载/事件流”，每次建立一条**临时连接**，不影响控制通道 self.connection
        let host = NWEndpoint.Host("127.0.0.1")
        let port = NWEndpoint.Port(rawValue: streamPort)!
        let conn = NWConnection(host: host, port: port, using: .tcp)

        // 工具：一次性完成回调，避免多次触发
        var finished = false
        let finishLock = NSLock()
        func finish(_ result: Result<Void, Error>) {
            finishLock.lock()
            defer { finishLock.unlock() }
            guard !finished else { return }
            finished = true
            conn.cancel()
            onClose(result)
        }

        // 3) 启动连接并等待 ready（最多 timeout 秒）
        let connectSema = DispatchSemaphore(value: 0)
        var readyOK = false
        conn.stateUpdateHandler = { st in
            switch st {
            case .ready:
                readyOK = true
                connectSema.signal()
            case .failed(let err):
                NSLog("YDLHelperSocket.stream: connect failed: \(err)")
                connectSema.signal()
            case .cancelled:
                connectSema.signal()
            default:
                break
            }
        }
        conn.start(queue: .global())
        _ = connectSema.wait(timeout: .now() + timeout)
        guard readyOK else {
            let err = NSError(
                domain: "YDLHelperSocket.Stream",
                code: -1001,
                userInfo: [
                    NSLocalizedDescriptionKey: "connect timeout/not ready"
                ]
            )
            finish(.failure(err))
            // 返回一个空取消闭包（已结束）
            return {}
        }

        // 4) 发送单行命令
        let payload = (line + "\n").data(using: .utf8) ?? Data()
        let t0 = Date()
        NSLog("YDLHelperSocket.stream: send cmd=%@ at %@", line, "\(t0)")
        let sendSema = DispatchSemaphore(value: 0)
        conn.send(
            content: payload,
            completion: .contentProcessed { err in
                if let err = err {
                    NSLog("YDLHelperSocket.stream: send error: \(err)")
                }
                sendSema.signal()
            }
        )
        _ = sendSema.wait(timeout: .now() + timeout)

        // 5) 进入“逐行”读取循环；遇到 '\n' 即回调一行
        var buffer = Data()

        func receiveLoop() {
            conn.receive(minimumIncompleteLength: 1, maximumLength: 32 * 1024) {
                data,
                _,
                isComplete,
                err in
                if let err = err {
                    // 网络错误，结束
                    NSLog("YDLHelperSocket.stream: recv error: \(err)")
                    finish(.failure(err))
                    return
                }

                if let d = data, !d.isEmpty {
                    buffer.append(d)

                    // 从 buffer 中不断切出完整行（以 '\n' 结尾）
                    while let nl = buffer.firstIndex(of: 0x0A) {  // 0x0A = '\n'
                        let lineData = buffer[..<nl]
                        // 移除到 '\n'（包含 '\n'）
                        buffer.removeSubrange(...nl)

                        if let s = String(data: lineData, encoding: .utf8) {
                            // 逐行回调
                            onEvent(s)
                            // 若满足“停止条件”，即刻结束（视为成功）
                            if let stop = stopWhen, stop(s) {
                                finish(.success(()))
                                return
                            }
                        } else {
                            NSLog("YDLHelperSocket.stream: decode line failed")
                        }
                    }

                    // 继续收
                    receiveLoop()
                    return
                }

                if isComplete {
                    // 对端优雅关闭（EOF）
                    NSLog("YDLHelperSocket.stream: EOF")
                    finish(.success(()))
                    return
                }

                // 未拿到数据但也未 EOF，继续收
                receiveLoop()
            }
        }

        receiveLoop()

        // 6) 返回取消闭包：可用于中止当前流式会话
        let cancelClosure: () -> Void = {
            let err = NSError(
                domain: "YDLHelperSocket.Stream",
                code: -999,
                userInfo: [NSLocalizedDescriptionKey: "cancelled by user"]
            )
            finish(.failure(err))
        }
        return cancelClosure
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
        let port = NWEndpoint.Port(rawValue: controlPort)!
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
}

extension YDLHelperSocket {

    func versionTest(timeout: TimeInterval = 5.0) -> String {
        startIfNeeded()

        let payload: [String: Any] = [
            "cmd": "version"
        ]
        guard
            let data = try? JSONSerialization.data(withJSONObject: payload),
            let line = String(data: data, encoding: .utf8)
        else {
            print("invalid version payload to python server")
            return "(invalid payload)"
        }

        let result = requestLine(line, timeout: timeout)
        print("YDLHelperSocket raw result:", result ?? "<-no result->")

        // ✅ 解析 JSON
        if let r = result,
            let data = r.data(using: .utf8),
            let obj = try? JSONSerialization.jsonObject(with: data)
                as? [String: Any]
        {
            if let ok = obj["ok"] as? Bool, ok,
                let version = obj["version"] as? String
            {
                return version
            }
        }

        return "(获取版本失败)"
    }

    func cancelTask(taskID: String, timeout: TimeInterval = 15.0) {
        startIfNeeded()

        let payload: [String: Any] = [
            "cmd": "cancel",
            "task_id": taskID,
        ]
        guard
            let data = try? JSONSerialization.data(withJSONObject: payload),
            let line = String(data: data, encoding: .utf8)
        else {
            print("invalid version payload to python server")
            return
        }

        let result = requestLine(line, timeout: timeout)
        print("YDLHelperSocket raw result:", result ?? "<-no result->")

    }

    func fetchVideoInfo(
        url: String,
        videoID: String,
        cookiesFile: String,
        proxy: String?,  // 可选
        timeout: TimeInterval = 15.0
    ) -> YTDLP.YTDLPInfo? {

        // 1) 统一缓存入口：先内存、再磁盘
        if let cached = TempInfoCache.shared.get(videoID: videoID) {
            NSLog("fetchVideoInfo: hit cache for \(videoID)")
            return cached
        }

        startIfNeeded()

        var payload: [String: String] = [
            "cmd": "videometa",
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
            TempInfoCache.shared.set(videoID: videoID, info: info)
            return info  // 直接返回 YTDLPInfo
        }

        // 兜底：如果有杂质，提取第一段顶层 JSON 再解
        if let firstJSON = YTDLP.extractTopLevelJSONObjects(from: result).first,
            let info = YTDLP.decodeYTDLPInfo(from: Data(firstJSON.utf8))
        {
            TempInfoCache.shared.set(videoID: videoID, info: info)
            return info
        }

        NSLog("fetchVideoInfo: failed to decode YTDLPInfo")
        return nil
    }

}

extension YDLHelperSocket {
    /// 发起下载（事件流），返回取消闭包
    @discardableResult
    func startDownload(
        taskID: String,
        url: String,
        formatValue: String,
        outputTemplate: String,
        cookiesFile: String,
        proxy: String?,
        onEvent: @escaping (String) -> Void,
        onClose: @escaping (Result<Void, Error>) -> Void
    ) -> () -> Void {
        // 组装一行 JSON 命令（下载通道协议）
        var payload: [String: Any] = [
            "cmd": "download",
            "url": url,
            "task_id": taskID,
            "format_value": formatValue,
            "output_template": outputTemplate,
            "cookies": cookiesFile,
        ]
        if let proxy, !proxy.isEmpty { payload["proxy"] = proxy }

        guard
            let data = try? JSONSerialization.data(
                withJSONObject: payload,
                options: []
            ),
            let line = String(data: data, encoding: .utf8)
        else {
            NSLog("startDownload: encode payload failed")
            onClose(
                .failure(
                    NSError(
                        domain: "YDLHelperSocket",
                        code: -1,
                        userInfo: [NSLocalizedDescriptionKey: "encode failed"]
                    )
                )
            )
            return {}
        }

        // stopWhen：读到 "event":"done" 或 "event":"error" 即结束
        let stopWhen: (String) -> Bool = { s in
            // 粗匹配足够用，避免为性能每行都做完整 JSON 解析
            return s.contains(#""event":"done""#)
                || s.contains(#""event":"error""#)
        }

        return requestStream(
            line,
            timeout: 15.0,
            stopWhen: stopWhen,
            onEvent: onEvent,
            onClose: onClose
        )
    }
}
