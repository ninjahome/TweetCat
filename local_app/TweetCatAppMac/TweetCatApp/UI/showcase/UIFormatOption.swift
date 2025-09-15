//
//  UIFormatOption.swift
//  TweetCatApp
//
//  Created by wesley on 2025/9/12.
//

import Combine
import Foundation

struct UIFormatOption: Identifiable, Equatable {
    let id = UUID()

    // === 下载所需（关键） ===
    let formatValue: String
    let kind: Kind
    let height: Int

    // === 展示/提示 ===
    let resolution: String
    let container: String
    let estSizeMB: Int?
    let note: String?

    // === 元信息 ===
    let videoItag: String?
    let audioItag: String?
    let vcodec: String?
    let acodec: String?
    let ext: String?
    let proto: String?
    let estBitrateKbps: Double?
    let estFilesizeBytes: Int?

    enum Kind: String {
        case merged = "合并"
        case video = "视频"
        case audio = "音频"
    }

    enum Compatibility: String, CaseIterable {
        case apple = "Apple 设备推荐"
        case windows = "Windows 常见格式"
        case tv = "TV/现代设备"
        case other = "其他/高级"
    }

    var compatibility: Compatibility {
        let vc = UIFormatOption.normalizeCodec(vcodec)
        let ac = UIFormatOption.normalizeCodec(acodec)
        let ext = container.lowercased()

        if ext == "mp4", vc == "avc1", ac == "aac" {
            return .apple
        }
        if ext == "mp4" || ext == "webm",
            vc == "avc1" || vc == "vp9",
            ac == "aac" || ac == "opus"
        {
            return .windows
        }
        if ["avc1", "vp9", "av01"].contains(vc ?? "") {
            return .tv
        }
        return .other
    }
}

extension UIFormatOption {
    static func normalizeCodec(_ c: String?) -> String? {
        guard let c else { return nil }
        if c.hasPrefix("avc1") { return "avc1" }
        if c.hasPrefix("mp4a") { return "aac" }
        if c.hasPrefix("vp9") { return "vp9" }
        if c.hasPrefix("av01") { return "av01" }
        if c.hasPrefix("opus") { return "opus" }
        return c
    }

    private static func makeNote(vcodec: String?, acodec: String?) -> String {
        let vc = normalizeCodec(vcodec)
        let ac = normalizeCodec(acodec)
        let codecNote = [vc, ac].compactMap { $0 }.joined(separator: "+")

        var compat = ""
        if let v = vc, v == "avc1" {
            compat = "✅ macOS 兼容"
        } else if let v = vc, v == "vp9" {
            compat = "⚠ 可能无法播放"
        } else if let v = vc, v == "av01" {
            compat = "⚠ AV1 需新播放器"
        }

        return codecNote.isEmpty ? compat : "\(codecNote) \(compat)"
    }

    /// 从 YTDLPInfo 构造 UIFormatOption 列表，简化 codec 显示并去重
    static func fromYTDLPInfo(_ info: YTDLP.YTDLPInfo) -> [UIFormatOption] {
        let formatsById: [String: YTDLP.YTDLPFormat] = Dictionary(
            uniqueKeysWithValues: info.formats.compactMap { f in
                guard let fid = f.format_id else { return nil }
                return (fid, f)
            }
        )

        var results: [UIFormatOption] = []

        // 1) Progressive 流
        for f in info.formats {
            if let fid = f.format_id,
                f.vcodec != "none", f.acodec != "none"
            {
                let height = f.height ?? 0
                let resText = "\(height)p"
                let estSize = f.filesize ?? f.filesize_approx ?? 0
                results.append(
                    UIFormatOption(
                        formatValue: fid,
                        kind: .video,
                        height: height,
                        resolution: resText,
                        container: f.ext ?? "mp4",
                        estSizeMB: estSize > 0
                            ? Int(Double(estSize) / 1024 / 1024) : nil,
                        note: makeNote(vcodec: f.vcodec, acodec: f.acodec),
                        videoItag: fid,
                        audioItag: nil,
                        vcodec: f.vcodec,
                        acodec: f.acodec,
                        ext: f.ext,
                        proto: f.proto,
                        estBitrateKbps: f.tbr,
                        estFilesizeBytes: estSize > 0 ? Int(estSize) : nil
                    )
                )
            }
        }

        // 2) Video-only + 默认音频（140 > 251）
        let audioCandidate = formatsById["140"] ?? formatsById["251"]

        for f in info.formats {
            if let fid = f.format_id,
                f.vcodec != "none", f.acodec == "none"
            {
                if let a = audioCandidate, let aid = a.format_id {
                    let height = f.height ?? 0
                    let resText = "\(height)p"
                    let estSize =
                        (f.filesize ?? f.filesize_approx ?? 0)
                        + (a.filesize ?? a.filesize_approx ?? 0)
                    results.append(
                        UIFormatOption(
                            formatValue: "\(fid)+\(aid)",
                            kind: .merged,
                            height: height,
                            resolution: resText,
                            container: "mp4",
                            estSizeMB: estSize > 0
                                ? Int(Double(estSize) / 1024 / 1024) : nil,
                            note: makeNote(vcodec: f.vcodec, acodec: a.acodec),
                            videoItag: fid,
                            audioItag: aid,
                            vcodec: f.vcodec,
                            acodec: a.acodec,
                            ext: f.ext,
                            proto: f.proto,
                            estBitrateKbps: ((f.tbr ?? 0) + (a.tbr ?? 0)),
                            estFilesizeBytes: estSize > 0 ? Int(estSize) : nil
                        )
                    )
                }
            }
        }

        // 3) 去重：相同 (height, vcodec简化, acodec简化) 只保留一个
        var unique: [String: UIFormatOption] = [:]
        for opt in results {
            let key =
                "\(opt.height)-\(normalizeCodec(opt.vcodec) ?? "none")-\(normalizeCodec(opt.acodec) ?? "none")"
            if unique[key] == nil {
                unique[key] = opt
            }
        }

        // 4) 按清晰度排序（高到低）
        return Array(unique.values).sorted { $0.height > $1.height }
    }

    static func debugPrintOptions(_ opts: [UIFormatOption]) {
        print("== 转换后的 UIFormatOption 列表，共 \(opts.count) 项 ==")
        for (idx, o) in opts.enumerated() {
            let sizeStr = o.estSizeMB.map { "\($0)MB" } ?? "n/a"
            let brStr =
                o.estBitrateKbps.map { String(format: "%.0f kbps", $0) }
                ?? "n/a"
            let comp = o.compatibility.rawValue
            print(
                String(
                    format:
                        "[%02d] value=%@ kind=%@ res=%@ container=%@ size=%@ br=%@ note=%@ | cat=%@",
                    idx,
                    o.formatValue,
                    o.kind.rawValue,
                    o.resolution,
                    o.container,
                    sizeStr,
                    brStr,
                    o.note ?? "",
                    comp
                )
            )
        }
    }

}
