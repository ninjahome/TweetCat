//
//  NMHostError.swift
//  TweetCatApp
//
//  Created by wesley on 2025/9/5.
//


import Foundation

enum NMHostError: Error { case eof, invalidHeader, invalidJSON, tooLarge }

/// 浏览器原生消息：4字节小端长度 + JSON
struct NativeMessagingHost {
    // 启动参数：--nm-host
    // 环境变量：NATIVE_MESSAGING_HOST=1
    static var shouldRunAsHost: Bool {
        let args = ProcessInfo.processInfo.arguments
        if args.contains("--nm-host") { return true }
        if ProcessInfo.processInfo.environment["NATIVE_MESSAGING_HOST"] == "1" { return true }
        return false
    }

    /// Host 主流程：读1条消息 -> 回1条 mock 响应 -> 退出
    static func runOnceAndExit() {
        let stdin = FileHandle.standardInput
        let stdout = FileHandle.standardOutput
        do {
            let req = try readMessage(stdin: stdin)
            let resp = makeMockResponse(for: req)
            try writeMessage(resp, to: stdout)
            // 正常结束
            exit(0)
        } catch NMHostError.eof {
            // 无输入直接退出
            exit(0)
        } catch {
            // 失败时，尽量写一个错误 JSON 再退出
            let err: [String: Any] = ["ok": false, "error": "\(error)"]
            try? writeMessage(err, to: FileHandle.standardOutput)
            exit(1)
        }
    }

    // MARK: - 协议编解码
    private static func readExact(_ count: Int, from handle: FileHandle) throws -> Data {
        var out = Data()
        out.reserveCapacity(count)
        var remaining = count
        while remaining > 0 {
            if let chunk = try handle.read(upToCount: remaining), !chunk.isEmpty {
                out.append(chunk)
                remaining -= chunk.count
            } else {
                throw NMHostError.eof
            }
        }
        return out
    }

    private static func readMessage(stdin: FileHandle) throws -> [String: Any] {
        let header = try readExact(4, from: stdin)
        guard header.count == 4 else { throw NMHostError.invalidHeader }
        let len = header.withUnsafeBytes { $0.load(as: UInt32.self) }.littleEndian
        if len > 50_000_000 { throw NMHostError.tooLarge } // 50MB 安全上限
        let payload = try readExact(Int(len), from: stdin)
        let any = try JSONSerialization.jsonObject(with: payload, options: [.allowFragments])
        guard let dict = any as? [String: Any] else { throw NMHostError.invalidJSON }
        return dict
    }

    private static func writeMessage(_ json: [String: Any], to stdout: FileHandle) throws {
        let data = try JSONSerialization.data(withJSONObject: json, options: [])
        var n = UInt32(data.count).littleEndian
        let header = withUnsafeBytes(of: &n) { Data($0) }
        stdout.write(header)
        stdout.write(data)
        try stdout.synchronize()
    }

    // MARK: - 伪造响应（先打通链路）
    private static func makeMockResponse(for req: [String: Any]) -> [String: Any] {
        let action = (req["action"] as? String) ?? "unknown"
        let items: [[String: Any]] = [
            ["label": "720p AVC + m4a（mock）", "value": "best[height<=720]", "height": 720, "kind": "progressive"],
            ["label": "1080p (video-only, mock)", "value": "bestvideo[height<=1080]+bestaudio", "height": 1080, "kind": "merge"]
        ]
        return [
            "ok": true,
            "action": action,
            "message": "mock response from Swift host",
            "formats": ["items": items],
            "echo": req
        ]
    }
}
