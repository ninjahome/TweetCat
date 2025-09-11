import Foundation

/// 针对 yt-dlp 的简单封装
enum YTDLP {
    /// 在 App Bundle 里定位 yt-dlp_macos，可按需扩展更多候选路径
    static func resolveBinaryURL() -> URL? {
        Bundle.main.url(forResource: "yt-dlp_macos", withExtension: nil)
    }

    // 用于解析 yt-dlp -J 的最小模型
    struct YTDLPFormat: Decodable {
        let format_id: String?
        let ext: String?
        let acodec: String?
        let vcodec: String?
        let resolution: String?  // 例如 "1920x1080" 或 "audio only"
        let width: Int?
        let height: Int?
        let tbr: Double?  // 总码率 kbps
        let filesize: Int64?
        let filesize_approx: Int64?
        let format_note: String?  // 例如 "dash" / "drc" / "storyboard"
        let proto: String?  // ← 新增：承接 JSON 的 "protocol"

        private enum CodingKeys: String, CodingKey {
            case format_id, ext, acodec, vcodec, resolution, width,
                height, tbr, filesize, filesize_approx,
                format_note
            case proto = "protocol"
        }
    }

    // MARK: - 字幕信息
    struct SubtitleInfo: Decodable {
        let url: String
        let ext: String
    }
    // MARK: - UI 字幕选项转换（预留）
    struct SubtitleOption: Decodable {
        let lang: String
        let ext: String
        let url: String
    }

    struct YTDLPInfo: Decodable {
        let id: String
        let title: String
        let duration: Int?
        let formats: [YTDLPFormat]

        // 可选：字幕信息
        let subtitles: [String: [SubtitleInfo]]?
        let automatic_captions: [String: [SubtitleInfo]]?
    }

    // MARK: - 解析与工具
    public static func decodeYTDLPInfo(from data: Data) -> YTDLPInfo? {
        do {
            let decoder = JSONDecoder()
            decoder.keyDecodingStrategy = .useDefaultKeys
            return try decoder.decode(YTDLPInfo.self, from: data)
        } catch {
            // 调试日志，帮助定位 JSON 解析失败的原因
            if let s = String(data: data, encoding: .utf8) {
                print("[YTDLP][decode error] 原始输出前50字节:\n\(s.prefix(50))")
            } else {
                print("[YTDLP][decode error] 无法将 Data 转为 UTF-8 字符串")
            }
            print("[YTDLP][decode error] 失败原因: \(error)")
        }
        return nil
    }

    /// 从任意文本里用“花括号计数法”抽取一个或多个完整 JSON 对象
    public static func extractTopLevelJSONObjects(from text: String)
        -> [String]
    {
        var results: [String] = []
        var depth = 0
        var startIdx: String.Index? = nil

        for (i, ch) in text.enumerated() {
            let idx = text.index(text.startIndex, offsetBy: i)
            if ch == "{" {
                if depth == 0 { startIdx = idx }
                depth += 1
            } else if ch == "}" {
                if depth > 0 { depth -= 1 }
                if depth == 0, let s = startIdx {
                    let obj = String(text[s...idx])
                    results.append(obj)
                    startIdx = nil
                }
            }
        }
        return results
    }

    public static func printSummary(_ info: YTDLPInfo) {
        print("== yt-dlp JSON 摘要 ==")
        print("id: \(info.id)")
        print("title: \(info.title)")
        print("formats count: \(info.formats.count)")
        for (idx, f) in info.formats.enumerated() {
            let res =
                f.resolution
                ?? (f.height != nil && f.width != nil
                    ? "\(f.width!)x\(f.height!)" : "n/a")
            let v = f.vcodec ?? "none"
            let a = f.acodec ?? "none"
            let size = f.filesize ?? f.filesize_approx
            let sizeStr = size.map { humanSize($0) } ?? "n/a"
            let br =
                f.tbr.map { String(format: "%.0fkbps", $0) }
                ?? "n/a"
            print(
                String(
                    format:
                        "[%02d] itag=%@ ext=%@ res=%@ v=%@ a=%@ br=%@ size=%@ note=%@",
                    idx,
                    f.format_id ?? "n/a",
                    f.ext ?? "n/a",
                    res,
                    v,
                    a,
                    br,
                    sizeStr,
                    f.format_note ?? ""
                )
            )
        }
    }

    private static func humanSize(_ bytes: Int64) -> String {
        let units = ["B", "KB", "MB", "GB", "TB"]
        var val = Double(bytes)
        var i = 0
        while val >= 1024 && i < units.count - 1 {
            val /= 1024
            i += 1
        }
        return String(format: "%.1f%@", val, units[i])
    }

    // MARK: - Build downloadable options (Swift port of shell logic)

    struct DownloadOption {
        enum Kind: String { case merge, single }
        let label: String  // e.g. "1080p AVC (merge)" / "720p MP4 (progressive)"
        let value: String  // e.g. "299+140" or "22"
        let height: Int
        let kind: Kind
    }

    /// 过滤 & 组装可下载选项（等价于 ytdlp_host.sh 的 build_format_dropdown）
    static func buildDownloadOptions(from info: YTDLPInfo)
        -> [DownloadOption]
    {
        let formats = info.formats.filter { ($0.format_id?.isEmpty == false) }
        // 与脚本一致
        let allowedVideoExt: Set<String> = ["mp4", "webm"]
        let minHeight = 144

        func isStoryboard(_ f: YTDLPFormat) -> Bool {
            let ext = (f.ext ?? "").lowercased()
            let note = (f.format_note ?? "").lowercased()
            return ext == "mhtml" || note.contains("storyboard")
                || note.contains("images")
        }
        func isM3U8Progressive(_ f: YTDLPFormat) -> Bool {
            // 参考脚本：过滤 m3u8 progressive（一般交给 yt-dlp 自行处理，不用于单个 itag 直下）
            return false  // 如果需要严格同脚本，先读取 f.protocol；当前 -J 模型没包含 protocol，则跳过此过滤
        }
        func validVideoOnly(_ f: YTDLPFormat) -> Bool {
            if isStoryboard(f) { return false }
            if (f.acodec ?? "") != "none" { return false }
            guard let h = f.height, h >= minHeight else {
                return false
            }
            if (f.vcodec ?? "") == "none" { return false }
            let ext = (f.ext ?? "").lowercased()
            return allowedVideoExt.contains(ext)
        }

        func validProgressive(_ f: YTDLPFormat) -> Bool {
            if isStoryboard(f) { return false }
            // 关键：排除 HLS/m3u8 progressive（shell 里就是这么干的）
            if let p = f.proto?.lowercased(), p.contains("m3u8") {
                return false
            }
            let a = f.acodec ?? "none"
            let v = f.vcodec ?? "none"
            if a == "none" || v == "none" { return false }
            guard let h = f.height, h >= minHeight else {
                return false
            }
            let ext = (f.ext ?? "").lowercased()
            return allowedVideoExt.contains(ext)
        }

        func validAudioOnly(_ f: YTDLPFormat) -> Bool {
            if isStoryboard(f) { return false }
            return (f.vcodec ?? "") == "none"
        }

        func codecTag(_ vcodec: String?) -> String {
            let vc = vcodec ?? ""
            if vc.hasPrefix("avc1") { return "AVC" }
            if vc.hasPrefix("vp9") { return "VP9" }
            if vc.hasPrefix("av01") { return "AV1" }
            return vc.isEmpty ? "?" : vc
        }

        var videoOnly: [(id: String, height: Int, vcodec: String)] = []
        var audioOnly: [(id: String, acodec: String, abr: Double)] = []
        var progressive:
            [(
                id: String, height: Int, ext: String,
                vcodec: String, acodec: String
            )] = []

        for f in formats {

            guard let fid = f.format_id else {
                continue
            }

            if validVideoOnly(f) {
                videoOnly.append(
                    (fid, f.height ?? 0, f.vcodec ?? "")
                )
            } else if validAudioOnly(f) {
                audioOnly.append(
                    (fid, f.acodec ?? "", f.tbr ?? 0)
                )
            } else if validProgressive(f) {
                progressive.append(
                    (
                        fid, f.height ?? 0,
                        (f.ext ?? ""), (f.vcodec ?? ""),
                        (f.acodec ?? "")
                    )
                )
            }
        }

        // 与脚本相同：优先选择 itag=140 作为音轨（若存在）
        let preferAudio = audioOnly.first(where: { $0.id == "140" })
        var items: [DownloadOption] = []

        if let a = preferAudio {
            for v in videoOnly {
                let label =
                    "\(v.height)p \(codecTag(v.vcodec)) (merge)"
                let value = "\(v.id)+\(a.id)"  // e.g. "299+140"
                items.append(
                    DownloadOption(
                        label: label,
                        value: value,
                        height: v.height,
                        kind: .merge
                    )
                )
            }
        }

        for p in progressive {
            let label =
                "\(p.height)p \(p.ext.uppercased()) (progressive)"
            items.append(
                DownloadOption(
                    label: label,
                    value: p.id,
                    height: p.height,
                    kind: .single
                )
            )
        }

        // 排序 & 去重（与脚本一致：按清晰度高→低，single 稍优先；value 去重）
        items.sort { (lhs, rhs) in
            if lhs.height != rhs.height {
                return lhs.height > rhs.height
            }
            // single 比 merge 更“稳定”，与脚本 sort 的次序相当（kind=="single" 优先）
            if lhs.kind != rhs.kind { return lhs.kind == .single }
            return lhs.label < rhs.label
        }
        var seen = Set<String>()
        items = items.filter { seen.insert($0.value).inserted }

        return items
    }

    /// 打印所有可选项 + 可直接使用的 yt-dlp 参数/完整命令
    static func printDownloadOptions(
        _ items: [DownloadOption],
        url: String,
        cookieFile: String = kTweetCatCookieFile
    ) {
        let outTmpl =
            ("\(NSHomeDirectory())/Downloads/%(title)s.%(ext)s")
        print("== 可下载选项（\(items.count)）==")
        for (idx, it) in items.enumerated() {
            // 与 shell 一致的参数：-f <value>（merge 或 single 都可用），并建议 --merge-output-format mp4
            let ytdlpArgs =
                "-f \(it.value) --merge-output-format mp4"
            let fullCmd =
                "yt-dlp --cookies \(cookieFile) \(ytdlpArgs) -o \"\(outTmpl)\" \"\(url)\""
            print(
                String(
                    format:
                        "[%02d] %@\n   value: %@\n   ytdlp: %@",
                    idx,
                    it.label,
                    it.value,
                    fullCmd
                )
            )
        }
    }

    private static func decodeYTDLPInfoFromNDJSON(_ text: String) -> YTDLPInfo?
    {
        for line in text.split(separator: "\n") {
            let s = String(line)
            if let data = s.data(using: .utf8),
                let info = decodeYTDLPInfo(from: data)
            {
                return info
            }

        }
        return nil
    }

    static func buildSubtitleOptions(from info: YTDLPInfo) -> [SubtitleOption] {
        var result: [SubtitleOption] = []

        if let subs = info.subtitles {
            for (lang, arr) in subs {
                for item in arr {
                    result.append(
                        SubtitleOption(lang: lang, ext: item.ext, url: item.url)
                    )
                }
            }
        }

        if let autoSubs = info.automatic_captions {
            for (lang, arr) in autoSubs {
                for item in arr {
                    result.append(
                        SubtitleOption(
                            lang: "\(lang) (auto)",
                            ext: item.ext,
                            url: item.url
                        )
                    )
                }
            }
        }

        return result
    }
}
