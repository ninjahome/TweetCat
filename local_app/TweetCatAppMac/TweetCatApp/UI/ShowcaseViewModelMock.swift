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
