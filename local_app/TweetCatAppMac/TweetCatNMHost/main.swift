import AppKit
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

// ====== 占位逻辑函数 ======

private let UI_BUNDLE_ID = "com.dessage.tweetcatapp"  // 改成你的 UI App Bundle Identifier

private func isUIRunning() -> Bool {
        !NSRunningApplication.runningApplications(
                withBundleIdentifier: UI_BUNDLE_ID
        ).isEmpty
}

private func launchUIIfNeeded(timeout: TimeInterval = 10) throws {
        if isUIRunning() { return }  // 已在运行，不重复启动

        guard
                let appURL = NSWorkspace.shared.urlForApplication(
                        withBundleIdentifier: UI_BUNDLE_ID
                )
        else {
                throw NSError(
                        domain: "NMHost",
                        code: 404,
                        userInfo: [
                                NSLocalizedDescriptionKey:
                                        "UI app not found by bundle id: \(UI_BUNDLE_ID)"
                        ]
                )
        }

        let cfg = NSWorkspace.OpenConfiguration()
        var launchError: Error?
        let sem = DispatchSemaphore(value: 1)
        sem.wait()
        NSWorkspace.shared.openApplication(at: appURL, configuration: cfg) {
                _,
                err in
                launchError = err
                sem.signal()
        }
        _ = sem.wait(timeout: .now() + timeout)
        if let e = launchError {
                throw e
        }
        // 再次确认已在运行
        if !isUIRunning() {
                throw NSError(
                        domain: "NMHost",
                        code: 408,
                        userInfo: [
                                NSLocalizedDescriptionKey:
                                        "UI app did not become running in time"
                        ]
                )
        }
}

func handleStart(_ req: [String: Any]) -> [String: Any] {
        do {
                try launchUIIfNeeded()
                return ["ok": true, "message": "success"]  // 已在运行或已成功拉起
        } catch {
                return [
                        "ok": false,
                        "message":
                                "failed to start UI: \(error.localizedDescription)",
                ]
        }
}

func handleCookie(_ req: [String: Any]) -> [String: Any] {
        return ["ok": true, "message": "success"]
}

func handleCheck(_ req: [String: Any]) -> [String: Any] {
        return ["ok": true, "message": "success"]
}

// ====== 主流程 ======
func run() {
        let stdin = FileHandle.standardInput
        let stdout = FileHandle.standardOutput
        do {
                // 1) 读浏览器扩展消息
                let req = try readMessage(stdin: stdin)

                // 2) 根据 action 分发
                let action = req["action"] as? String ?? ""
                let resp: [String: Any]

                switch action {
                case "start":
                        resp = handleStart(req)
                case "cookie":
                        resp = handleCookie(req)
                case "check":
                        resp = handleCheck(req)
                default:
                        resp = [
                                "ok": false,
                                "message": "unknown action: \(action)",
                        ]
                }

                // 3) 返回结果
                try writeMessage(resp, to: stdout)
                exit(0)

        } catch NMErr.eof {
                exit(0)
        } catch {
                try? writeMessage(
                        ["ok": false, "message": "\(error)"],
                        to: stdout
                )
                exit(1)
        }
}

// 顶层入口
run()
