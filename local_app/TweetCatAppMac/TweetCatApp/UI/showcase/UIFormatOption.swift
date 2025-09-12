//
//  UIFormatOption.swift
//  TweetCatApp
//
//  Created by wesley on 2025/9/12.
//

import Combine
import Foundation

// ShowcaseViewModelMock.swift 里，替换 UIFormatOption 为：
struct UIFormatOption: Identifiable, Equatable {
    let id = UUID()

    // === 下载所需（关键） ===
    let formatValue: String  // e.g. "299+140" 或 "22"
    let kind: Kind  // merged / video(=single)
    let height: Int  // 便于显示/排序

    // === 展示/提示 ===
    let resolution: String  // 例如 "1080p"
    let container: String  // 展示：合并统一展示 mp4；progressive 用真实 ext
    let estSizeMB: Int?  // 预计大小（MB）
    let note: String?  // 从 DownloadOption.label 带过来（如 "1080p AVC (merge)"）

    // === 元信息（可选，但推荐） ===
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
        case video = "视频"  // 对应 single/progressive
        case audio = "音频"  // 预留，当前不生成独立音频项
    }
}

extension UIFormatOption {
    /// 从 YTDLPInfo 构造一组 UIFormatOption（包含完整下载参数）
    static func fromYTDLPInfo(_ info: YTDLP.YTDLPInfo) -> [UIFormatOption] {
        // 1) 建立查找表，便于通过 itag 查细节
        let formatsById: [String: YTDLP.YTDLPFormat] = Dictionary(
            uniqueKeysWithValues: info.formats.compactMap { f in
                guard let fid = f.format_id else { return nil }
                return (fid, f)
            }
        )

        // 2) 调用已有的 buildDownloadOptions
        return YTDLP.buildDownloadOptions(from: info).map { opt in
            let value = opt.value
            let height = opt.height
            let resText = "\(height)p"
            let noteText = opt.label

            var videoItag: String? = nil
            var audioItag: String? = nil
            var vcodec: String? = nil
            var acodec: String? = nil
            var ext: String? = nil
            var proto: String? = nil
            var estTbr: Double = 0
            var estSize: Int64 = 0

            switch opt.kind {
            case .merge:
                // value 类似 "299+140"
                let parts = value.split(separator: "+").map(String.init)
                videoItag = parts.first
                audioItag = parts.count > 1 ? parts[1] : nil

                if let v = videoItag.flatMap({ formatsById[$0] }) {
                    vcodec = v.vcodec
                    ext = v.ext
                    proto = v.proto
                    estTbr += v.tbr ?? 0
                    estSize += v.filesize ?? v.filesize_approx ?? 0
                }
                if let a = audioItag.flatMap({ formatsById[$0] }) {
                    acodec = a.acodec
                    estTbr += a.tbr ?? 0
                    estSize += a.filesize ?? a.filesize_approx ?? 0
                }

                return UIFormatOption(
                    formatValue: value,
                    kind: .merged,
                    height: height,
                    resolution: resText,
                    container: "mp4",  // merge 统一展示为 mp4
                    estSizeMB: estSize > 0
                        ? Int((Double(estSize) / 1024 / 1024).rounded()) : nil,
                    note: noteText,
                    videoItag: videoItag,
                    audioItag: audioItag,
                    vcodec: vcodec,
                    acodec: acodec,
                    ext: ext,
                    proto: proto,
                    estBitrateKbps: estTbr > 0 ? estTbr : nil,
                    estFilesizeBytes: estSize > 0 ? Int(estSize) : nil
                )

            case .single:
                // 单 itag（progressive）
                videoItag = value
                if let f = formatsById[value] {
                    vcodec = f.vcodec
                    acodec = f.acodec
                    ext = f.ext
                    proto = f.proto
                    estTbr = f.tbr ?? 0
                    estSize = f.filesize ?? f.filesize_approx ?? 0
                }

                return UIFormatOption(
                    formatValue: value,
                    kind: .video,
                    height: height,
                    resolution: resText,
                    container: (ext ?? "mp4"),  // 展示真实 ext
                    estSizeMB: estSize > 0
                        ? Int((Double(estSize) / 1024 / 1024).rounded()) : nil,
                    note: noteText,
                    videoItag: videoItag,
                    audioItag: nil,
                    vcodec: vcodec,
                    acodec: acodec,
                    ext: ext,
                    proto: proto,
                    estBitrateKbps: estTbr > 0 ? estTbr : nil,
                    estFilesizeBytes: estSize > 0 ? Int(estSize) : nil
                )
            }
        }
    }

    static func debugPrintOptions(_ opts: [UIFormatOption]) {
        print("== 转换后的 UIFormatOption 列表，共 \(opts.count) 项 ==")
        for (idx, o) in opts.enumerated() {
            let sizeStr = o.estSizeMB.map { "\($0)MB" } ?? "n/a"
            let brStr =
                o.estBitrateKbps.map { String(format: "%.0f kbps", $0) }
                ?? "n/a"
            print(
                String(
                    format:
                        "[%02d] value=%@ kind=%@ res=%@ container=%@ size=%@ br=%@ note=%@",
                    idx,
                    o.formatValue,
                    o.kind.rawValue,
                    o.resolution,
                    o.container,
                    sizeStr,
                    brStr,
                    o.note ?? ""
                )
            )
        }
    }
}
