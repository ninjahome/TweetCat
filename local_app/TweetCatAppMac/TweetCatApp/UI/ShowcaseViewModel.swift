//
//  ShowcaseViewModelMock.swift
//  TweetCatApp
//
//  Created by wesley on 2025/9/10.
//

import Combine
import Foundation

final class ShowcaseViewModel: ObservableObject {
    // 当前是否有候选（无候选时显示教程空状态）
    @Published var current: UIVideoCandidate? = nil

    // 是否展示格式选择 Sheet
    @Published var showFormatSheet: Bool = false

    // 拉取到的格式（假数据）
    @Published var formatOptions: [UIFormatOption] = []

    // 当前选择的格式
    @Published var selectedFormatID: UIFormatOption.ID? = nil

    @Published var loading: Bool = false
    @Published var errorMessage: String? = nil
    @Published var showError: Bool = false

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

    //    func fetchFormatsReal() {
    //        guard let c = current, let url = c.sourceURL?.absoluteString else {
    //            return
    //        }
    //
    //        Task {
    //            await MainActor.run {
    //                self.loading = true
    //            }
    //            print("[Download] 开始获取视频信息: \(c.title) (\(url))")
    //
    //            // 1. VPN 检测
    //            let inspector = NetworkInspector()
    //            let status = await inspector.detect()
    //            print("[Network] VPN 检测结果: \(status.note)")
    //            if !status.isLikelyVPNOrProxyAvailable {
    //                await MainActor.run {
    //                    self.errorMessage = "未检测到 VPN/代理，请先连接再试"
    //                    self.showError = true
    //                    self.loading = false  // 避免 loading 卡住
    //                }
    //                return  // ⬅️ 必须直接 return，退出 Task
    //            }
    //
    //            // 2. 生成代理配置
    //            let manualForm = ManualProxyForm()  // TODO: 从设置页传入
    //            let proxyConfig = ProxyApplier.makeYTDLPProxyConfig(
    //                network: status,
    //                manual: manualForm
    //            )
    //            print(
    //                "[Network] 使用代理配置: cli=\(proxyConfig.cliProxyURL ?? "无"), env=\(proxyConfig.env)"
    //            )
    //
    //            // 3. 调用 yt-dlp
    //            YTDLPManager.shared.enqueueQuery(
    //                videoId: c.videoId,
    //                url: url,
    //                timeout: 120,
    //                proxyConfig: proxyConfig
    //            ) { [weak self] result in
    //                Task { @MainActor in
    //                    guard let self else { return }
    //                    self.loading = false
    //
    //                    switch result {
    //                    case .success(let info):
    //                        print("[Download] 成功获取格式: 共 \(info.formats.count) 个选项")
    //                        let opts = YTDLP.buildDownloadOptions(from: info).map {
    //                            opt in
    //                            UIFormatOption(
    //                                kind: opt.kind == .merge ? .merged : .video,
    //                                resolution: "\(opt.height)p",
    //                                container: "mp4",
    //                                estSizeMB: nil,
    //                                note: opt.label
    //                            )
    //                        }
    //                        self.formatOptions = opts
    //                        self.selectedFormatID = opts.first?.id
    //                        self.showFormatSheet = true
    //                    case .failure(let err):
    //                        print("[Download] 获取失败: \(err)")
    //                        self.errorMessage = "获取格式失败：\(err.localizedDescription)"
    //                        self.showError = true
    //                    }
    //                }
    //            }
    //        }
    //    }

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

    private func cookiesFileURL() -> URL {
        URL(fileURLWithPath: kTweetCatCookieFile, isDirectory: false)
    }

    func fetchFormatsReal() {
        guard let c = current, let url = c.sourceURL?.absoluteString else {
            return
        }

        Task {
            await MainActor.run {
                self.loading = true
            }
            print("[Download] 开始获取视频信息: \(c.title) (\(url))")

            // 1. VPN 检测
            let inspector = NetworkInspector()
            let status = await inspector.detect()
            print("[Network] VPN 检测结果: \(status.note)")
            if !status.isLikelyVPNOrProxyAvailable {
                await MainActor.run {
                    self.errorMessage = "未检测到 VPN/代理，请先连接再试"
                    self.showError = true
                    self.loading = false
                }
                return
            }

            // 2. 生成代理配置
            let manualForm = ManualProxyForm()  // TODO: 从设置页传入
            let proxyConfig = ProxyApplier.makeYTDLPProxyConfig(
                network: status,
                manual: manualForm
            )
            print(
                "[Network] 使用代理配置: cli=\(proxyConfig.cliProxyURL ?? "无"), env=\(proxyConfig.env)"
            )

            // 3. 调用新的 YDLHelper
            let cookiesPath = cookiesFileURL().path
            if let info = YDLHelperSocket.shared.fetchVideoInfo(
                videoID: c.videoId,
                cookiesFile: cookiesPath,
                proxy: proxyConfig.cliProxyURL ?? "",
                timeout: 60
            ) {

                Task { @MainActor in
                    YTDLP.printSummary(info)
                    print("[Download] 成功获取格式: 共 \(info.formats.count) 个选项")
                    let opts = YTDLP.buildDownloadOptions(from: info).map {
                        opt in
                        UIFormatOption(
                            kind: opt.kind == .merge ? .merged : .video,
                            resolution: "\(opt.height)p",
                            container: "mp4",
                            estSizeMB: nil,
                            note: opt.label
                        )
                    }
                    self.loading = false
                    self.formatOptions = opts
                    self.selectedFormatID = opts.first?.id
                    self.showFormatSheet = true
                }
            } else {
                await MainActor.run {
                    self.loading = false
                    self.errorMessage = "获取视频信息失败"
                    self.showError = true
                }
            }
        }
    }

}
