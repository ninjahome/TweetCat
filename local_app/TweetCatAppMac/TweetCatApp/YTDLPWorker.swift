//
//  YTDLPWorker.swift
//  TweetCatApp
//
//  Created by wesley on 2025/9/6.
//

import Foundation

// MARK: - YTDLPWorker

final class YTDLPWorker {
        enum Kind { case meta /* 只做 -J 查询 */, download }
        enum State { case idle, busy, down }

        struct Task {
                let id: UUID = UUID()
                let commandLine: String
                let timeout: TimeInterval
                let completion: (Result<YTDLP.YTDLPInfo, Error>) -> Void
                var timer: DispatchSourceTimer?
        }

        private let kind: Kind
        public let cookiesPath: String
        private var process: Process?
        private var stdinHandle: FileHandle?
        private var stdoutHandle: FileHandle?
        private var stderrHandle: FileHandle?

        private let queue = DispatchQueue(label: "ytdlp.worker.queue")
        private var tasks: [Task] = []

        private var buffer = ""  // 收集 stdout

        init(kind: Kind, cookiesPath: String) {
                self.kind = kind
                self.cookiesPath = cookiesPath
        }

        func spawn() {
                guard let bin = YTDLP.resolveBinaryURL() else {
                        print("[Worker] 找不到 yt-dlp_macos")
                        return
                }

                let p = Process()
                p.executableURL = bin
                p.arguments = [
                        "--ignore-config", "--no-warnings", "--no-progress",
                        "--no-color",
                        "--batch-file", "-", "--cookies", cookiesPath,
                ]
                p.environment = ProxyConfig.vpn2  // 默认使用 vpn2
                let stdin = Pipe()
                let stdout = Pipe()
                let stderr = Pipe()
                p.standardInput = stdin
                p.standardOutput = stdout
                p.standardError = stderr

                p.terminationHandler = { [weak self] proc in
                        self?.queue.async {
                                print(
                                        "[Worker] 进程退出 code=\(proc.terminationStatus)"
                                )
                                // fail 所有在途任务
                                for t in self?.tasks ?? [] {
                                        t.completion(
                                                .failure(
                                                        NSError(
                                                                domain:
                                                                        "worker.exit",
                                                                code: Int(
                                                                        proc
                                                                                .terminationStatus
                                                                ),
                                                                userInfo: nil
                                                        )
                                                )
                                        )
                                }
                                self?.tasks.removeAll()
                                self?.process = nil
                        }
                }

                do {
                        try p.run()
                        self.process = p
                        self.stdinHandle = stdin.fileHandleForWriting
                        self.stdoutHandle = stdout.fileHandleForReading
                        self.stderrHandle = stderr.fileHandleForReading
                        startReadLoop()
                        print("[Worker] 启动成功 PID=\(p.processIdentifier)")
                } catch {
                        print("[Worker] 启动失败: \(error)")
                }
        }

        private func startReadLoop() {
                guard let stdout = stdoutHandle else { return }
                stdout.readabilityHandler = { [weak self] h in
                        guard
                                let chunk = String(
                                        data: h.availableData,
                                        encoding: .utf8
                                ), !chunk.isEmpty
                        else { return }
                        self?.queue.async {
                                self?.buffer.append(chunk)
                                self?.tryConsumeBuffer()
                        }
                }
        }

        private func tryConsumeBuffer() {
                // 用花括号计数法抽取 JSON
                var depth = 0
                var start: String.Index? = nil
                var i = buffer.startIndex

                while i < buffer.endIndex {
                        let ch = buffer[i]
                        if ch == "{" {
                                if depth == 0 { start = i }
                                depth += 1
                        } else if ch == "}" {
                                depth -= 1
                                if depth == 0, let s = start {
                                        let obj = String(buffer[s...i])
                                        buffer.removeSubrange(
                                                buffer.startIndex...i
                                        )
                                        handleJSONObject(obj)
                                        start = nil
                                        i = buffer.startIndex
                                        continue
                                }
                        }
                        i = buffer.index(after: i)
                }
        }

        private func handleJSONObject(_ json: String) {
                guard !tasks.isEmpty else { return }
                let task = tasks.removeFirst()
                task.timer?.cancel()
                if let info = YTDLP.decodeYTDLPInfo(from: json) {
                        task.completion(.success(info))
                } else {
                        task.completion(
                                .failure(
                                        NSError(
                                                domain: "decode.fail",
                                                code: -1,
                                                userInfo: ["raw": json]
                                        )
                                )
                        )
                }
        }

        func submitMeta(
                url: String,
                timeout: TimeInterval = 120,
                completion: @escaping (Result<YTDLP.YTDLPInfo, Error>) -> Void
        ) {
                queue.async {
                        guard let stdin = self.stdinHandle else {
                                completion(
                                        .failure(
                                                NSError(
                                                        domain: "worker.down",
                                                        code: -1
                                                )
                                        )
                                )
                                return
                        }
                        let line = "-J \"\(url)\"\n"
                        let task = Task(
                                commandLine: line,
                                timeout: timeout,
                                completion: completion
                        )
                        self.tasks.append(task)
                        // timeout
                        let timer = DispatchSource.makeTimerSource(
                                queue: self.queue
                        )
                        timer.schedule(deadline: .now() + timeout)
                        timer.setEventHandler { [weak self] in
                                if let idx = self?.tasks.firstIndex(where: {
                                        $0.id == task.id
                                }) {
                                        self?.tasks.remove(at: idx)
                                }
                                completion(
                                        .failure(
                                                NSError(
                                                        domain:
                                                                "worker.timeout",
                                                        code: -1
                                                )
                                        )
                                )
                        }
                        timer.resume()
                        var t = task
                        t.timer = timer

                        if let data = line.data(using: .utf8) {
                                stdin.write(data)
                                stdin.synchronizeFile()
                        }
                }
        }

        func stop() {
                process?.terminate()
                process = nil
        }
}
