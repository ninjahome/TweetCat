import Foundation

enum SubprocessError: Error {
    case executableNotFound(String)
    case executionFailed(Int32, String)
}

/// 统一的子进程执行器
struct Subprocess {
    /// 同步执行并返回 (退出码, 标准输出, 标准错误)
    @discardableResult
    static func run(executableURL: URL, arguments: [String] = []) throws -> (Int32, String, String) {
        let proc = Process()
        proc.executableURL = executableURL
        proc.arguments = arguments

        let stdout = Pipe()
        let stderr = Pipe()
        proc.standardOutput = stdout
        proc.standardError  = stderr

        try proc.run()
        proc.waitUntilExit()

        let outData = stdout.fileHandleForReading.readDataToEndOfFile()
        let errData = stderr.fileHandleForReading.readDataToEndOfFile()

        let out = String(data: outData, encoding: .utf8) ?? ""
        let err = String(data: errData, encoding: .utf8) ?? ""
        return (proc.terminationStatus, out, err)
    }
}

/// 针对 yt-dlp 的简单封装
enum YTDLP {
    /// 在 App Bundle 里定位 yt-dlp_macos，可按需扩展更多候选路径
    static func resolveBinaryURL() -> URL? {
        // 放在 “Copy Bundle Resources” 后会在这里
        if let url = Bundle.main.url(forResource: "yt-dlp_macos", withExtension: nil) {
            return url
        }
        // 如果你把它放到了 Resources/ffmpeg 之类的子目录，改成：
        // return Bundle.main.url(forResource: "yt-dlp_macos", withExtension: nil, subdirectory: "Resources")
        return nil
    }

    /// 打印版本信息
    static func printVersion() {
        guard let bin = resolveBinaryURL() else {
            print("yt-dlp_macos 不在 App Bundle 中，检查 Target Membership / Copy Bundle Resources。")
            return
        }

        // 确保可执行（你已经本地测过，通常签名后即可执行）
        do {
            let (code, out, err) = try Subprocess.run(executableURL: bin, arguments: ["--version"])
            if code == 0 {
                print("yt-dlp --version:", out.trimmingCharacters(in: .whitespacesAndNewlines))
            } else {
                print("yt-dlp 执行失败，code=\(code)\nstderr=\(err)")
            }
        } catch {
            print("启动 yt-dlp 失败：\(error)")
        }
    }
}
