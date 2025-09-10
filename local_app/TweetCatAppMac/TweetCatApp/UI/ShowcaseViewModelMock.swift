//
//  ShowcaseViewModelMock.swift
//  TweetCatApp
//
//  Created by wesley on 2025/9/10.
//

import Combine
import Foundation

final class ShowcaseViewModelMock: ObservableObject {
    // 当前是否有候选（无候选时显示教程空状态）
    @Published var current: UIVideoCandidate? = nil

    // 是否展示格式选择 Sheet
    @Published var showFormatSheet: Bool = false

    // 拉取到的格式（假数据）
    @Published var formatOptions: [UIFormatOption] = []

    // 当前选择的格式
    @Published var selectedFormatID: UIFormatOption.ID? = nil

    private var bag = Set<AnyCancellable>()

    init() {
        // 订阅 Host 过来的最新候选
        NativeMessageReceiver.shared.$latestCandidate
            .receive(on: DispatchQueue.main)
            .sink { [weak self] cand in
                guard let self, let cand else { return }
                self.current = cand
            }
            .store(in: &bag)
    }

    // 模拟：扩展消息抵达 → 显示候选
    func simulateIncomingCandidate() {
        // 切换两条假数据，便于演示
        if current?.videoId == ShowcaseMock.candidate1.videoId {
            current = ShowcaseMock.candidate2
        } else {
            current = ShowcaseMock.candidate1
        }
    }

    // 模拟：获取格式（用假数据填充）
    func fetchFormats() {
        guard let c = current else { return }
        if c.videoId == ShowcaseMock.candidate2.videoId {
            formatOptions = ShowcaseMock.formatsFor2
        } else {
            formatOptions = ShowcaseMock.formatsFor1
        }
        selectedFormatID = formatOptions.first?.id  // 默认选第一项
        showFormatSheet = true
    }

    func fetchFormatsReal() {
        guard let c = current, let url = c.sourceURL?.absoluteString else {
            return
        }
        YTDLPManager.shared.enqueueQuery(
            videoId: c.videoId,
            url: url,
            timeout: 60
        ) { [weak self] result in
            DispatchQueue.main.async {
                guard let self else { return }
                switch result {
                case .success(let info):
                    // 映射 info.formats -> [UIFormatOption]
                    let opts = YTDLP.buildDownloadOptions(from: info).map {
                        opt in
                        UIFormatOption(
                            kind: opt.kind == .merge ? .merged : .video,  // 简化：audio-only 会在 YTDLP.buildDownloadOptions 里控制
                            resolution: "\(opt.height)p",
                            container: "mp4",  // 或从 info 推导；先给默认
                            estSizeMB: nil,
                            note: opt.label
                        )
                    }
                    self.formatOptions = opts
                    self.selectedFormatID = opts.first?.id
                    self.showFormatSheet = true
                case .failure(let err):
                    // 你可以把错误抛给 UI；这里先简单打印
                    print("获取格式失败：\(err)")
                }
            }
        }
    }

    // 模拟：开始下载（这里只做提示，不创建真实任务）
    func startDownloadSelected() -> (title: String, message: String) {
        guard let c = current else {
            return ("未选择视频", "请先接收扩展消息或点击“模拟候选”按钮。")
        }
        guard
            let sel = formatOptions.first(where: { $0.id == selectedFormatID })
        else {
            return ("未选择格式", "请选择一个下载格式后再开始。")
        }
        let info = "\(sel.kind.rawValue) • \(sel.resolution) • \(sel.container)"
        return ("已创建下载任务（假）", "《\(c.title)》\n\(info)")
    }
}
