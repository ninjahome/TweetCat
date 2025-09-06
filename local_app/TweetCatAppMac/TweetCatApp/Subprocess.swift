//
//  SubprocessError.swift
//  TweetCatApp
//
//  Created by wesley on 2025/9/6.
//

import Foundation

enum SubprocessError: Error {
        case executableNotFound(String)
        case executionFailed(Int32, String)
        case timedOut
}

/// 统一的子进程执行器（支持流式读取与超时）
struct Subprocess {

        /// shell 可复制的调试串（仅用于日志）
        private static func shellEscaped(_ s: String) -> String {
                // 简化版：遇到空格或特殊字符就用单引号包裹，并把单引号转义
                if s.rangeOfCharacter(
                        from: CharacterSet.whitespacesAndNewlines.union(
                                CharacterSet(charactersIn: "\"'\\$`")
                        )
                ) != nil {
                        return "'"
                                + s.replacingOccurrences(of: "'", with: "'\\''")
                                + "'"
                }
                return s
        }

        /// 打印可复制的调试命令（不会影响真实传参）
        static func debugCommand(_ exe: URL, _ args: [String]) -> String {
                let parts = [shellEscaped(exe.path)] + args.map(shellEscaped)
                return parts.joined(separator: " ")
        }

        /// 同步执行（保持旧接口）- 适合极小输出；大量输出时建议用 runStreamed
        @discardableResult
        static func run(
                executableURL: URL,
                arguments: [String] = [],
                proxyEnv: [String: String]? = nil
        ) throws -> (Int32, String, String) {

                let proc = Process()
                proc.executableURL = executableURL
                proc.arguments = arguments
                proc.environment =
                        proxyEnv.map {
                                ProcessInfo.processInfo.environment.merging($0)
                                { _, new in new }
                        }
                        ?? ProcessInfo.processInfo.environment

                let stdout = Pipe()
                let stderr = Pipe()
                proc.standardOutput = stdout
                proc.standardError = stderr

                // ❗旧实现这里先 waitUntilExit 再读整块数据，容易造成管道阻塞死锁
                // 参考你的当前代码：L22-L30（readDataToEndOfFile 在子进程退出后才读）:contentReference[oaicite:1]{index=1}
                try proc.run()
                proc.waitUntilExit()

                let outData = stdout.fileHandleForReading.readDataToEndOfFile()
                let errData = stderr.fileHandleForReading.readDataToEndOfFile()

                let out = String(data: outData, encoding: .utf8) ?? ""
                let err = String(data: errData, encoding: .utf8) ?? ""
                return (proc.terminationStatus, out, err)
        }

        /// 流式执行：边跑边读，带超时；避免 pipe back-pressure
        @discardableResult
        static func runStreamed(
                executableURL: URL,
                arguments: [String] = [],
                proxyEnv: [String: String]? = nil,
                timeoutSec: TimeInterval = 120,
                onStdoutLine: ((String) -> Void)? = nil,
                onStderrLine: ((String) -> Void)? = nil
        ) throws -> (Int32, String, String) {

                let proc = Process()
                proc.executableURL = executableURL
                proc.arguments = arguments
                proc.environment =
                        proxyEnv.map {
                                ProcessInfo.processInfo.environment.merging($0)
                                { _, new in new }
                        }
                        ?? ProcessInfo.processInfo.environment

                let outPipe = Pipe()
                let errPipe = Pipe()
                proc.standardOutput = outPipe
                proc.standardError = errPipe

                let outFH = outPipe.fileHandleForReading
                let errFH = errPipe.fileHandleForReading

                var outBuf = Data()
                var errBuf = Data()

                let outQ = DispatchQueue(label: "subprocess.stdout")
                let errQ = DispatchQueue(label: "subprocess.stderr")
                let group = DispatchGroup()

                func consume(
                        _ fh: FileHandle,
                        queue: DispatchQueue,
                        into buffer: UnsafeMutablePointer<Data>,
                        callback: ((String) -> Void)?
                ) {
                        group.enter()
                        queue.async {
                                let delim = Data([0x0a])  // '\n'
                                var local = Data()
                                while true {
                                        let chunk = fh.readData(ofLength: 8192)
                                        if chunk.isEmpty { break }

                                        // ✅ 关键修复：把每个 chunk 累计到返回缓冲
                                        buffer.pointee.append(chunk)

                                        // 原有逐行回调逻辑保留
                                        local.append(chunk)
                                        while let range = local.firstRange(
                                                of: delim
                                        ) {
                                                let lineData = local.subdata(
                                                        in: 0..<range.lowerBound
                                                )
                                                local.removeSubrange(
                                                        0..<range.upperBound
                                                )
                                                if let s = String(
                                                        data: lineData,
                                                        encoding: .utf8
                                                ) {
                                                        callback?(s)
                                                }
                                        }
                                }

                                // 收尾：把最后一行（没有换行结尾）也回调一下（仅用于日志/观察）
                                if !local.isEmpty,
                                        let s = String(
                                                data: local,
                                                encoding: .utf8
                                        )
                                {
                                        callback?(s)
                                }

                                // ❌ 删掉这句（否则会重复）：buffer.pointee.append(local)
                                group.leave()
                        }
                }

                // 启动前建超时
                let deadline = DispatchTime.now() + timeoutSec
                let timeoutFlag = UnsafeMutablePointer<Bool>.allocate(
                        capacity: 1
                )
                timeoutFlag.initialize(to: false)

                try proc.run()

                // 启动后立即开始消费，避免阻塞
                consume(
                        outFH,
                        queue: outQ,
                        into: &outBuf,
                        callback: onStdoutLine
                )
                consume(
                        errFH,
                        queue: errQ,
                        into: &errBuf,
                        callback: onStderrLine
                )

                // 超时监控
                DispatchQueue.global().asyncAfter(deadline: deadline) {
                        if proc.isRunning {
                                timeoutFlag.pointee = true
                                proc.terminate()  // 优先优雅终止
                                // 如需更强硬，可延时再 proc.kill()（10.15+ 可用）
                        }
                }

                proc.waitUntilExit()
                group.wait()

                let out = String(data: outBuf, encoding: .utf8) ?? ""
                let err = String(data: errBuf, encoding: .utf8) ?? ""

                if timeoutFlag.pointee {
                        throw SubprocessError.timedOut
                }
                return (proc.terminationStatus, out, err)
        }

}
