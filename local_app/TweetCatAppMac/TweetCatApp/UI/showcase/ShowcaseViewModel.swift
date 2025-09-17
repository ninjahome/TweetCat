//
//  ShowcaseViewModelMock.swift
//  TweetCatApp
//
//  Created by wesley on 2025/9/10.
//

import Combine
import Foundation

final class ShowcaseViewModel: ObservableObject {
    static let shared = ShowcaseViewModel()
    @Published var current: UIVideoCandidate? = nil
    @Published var showFormatSheet: Bool = false
    @Published var history: [UIVideoCandidate] = []
    @Published var formatOptions: [UIFormatOption] = []
    @Published var selectedFormatID: UIFormatOption.ID? = nil
    @Published var loading: Bool = false
    @Published var errorMessage: String? = nil
    @Published var showError: Bool = false

    private var bag = Set<AnyCancellable>()

    private init() {
        NativeMessageReceiver.shared.$latestCandidate
            .receive(on: DispatchQueue.main)
            .sink { [weak self] cand in
                guard let self, let cand else { return }
                self.current = cand
                if let idx = self.history.firstIndex(where: {
                    $0.videoId == cand.videoId
                }) {
                    self.history.remove(at: idx)
                }
                self.history.insert(cand, at: 0)
            }
            .store(in: &bag)
    }

    func startDownloadSelected() {
        guard let c = current else {
            self.errorMessage = "未选择视频，请先接收扩展消息或点击“模拟候选”。"
            self.showError = true
            return
        }
        guard
            let sel = formatOptions.first(where: { $0.id == selectedFormatID })
        else {
            self.errorMessage = "未选择格式，请先选择一个下载格式后再开始。"
            self.showError = true
            return
        }

        let taskId = "\(c.videoId)_\(sel.formatValue)"
        let newTask = DownloadTask(
            id: taskId,
            videoId: c.videoId,
            title: c.title,
            formatSummary: sel.formatValue,
            pageTyp: c.pageTyp.lowercased(),
            progress: 0.0,
            speedText: "",
            etaText: "",
            downloadedText: "",
            state: .running,
            errorMessage: nil,
            thumbURL: c.thumbnailURL,
            filepath: nil,
            updatedAt: Date()
        )

        Task { @MainActor in
            DownloadCenter.shared.addTask(newTask)
        }

        // 1) URL
        let urlString =
            c.sourceURL?.absoluteString
            ?? "https://www.youtube.com/watch?v=\(c.videoId)"

        Task {
            let proxy = await prepareProxy()

            let cookiesPath = cookiesFileURL().path
            let cat = (c.pageTyp.lowercased() == "shorts") ? "shorts" : "watch"
            let dPath = AppConfigManager.shared.load().path(for: cat)

            let outTmpl =
                dPath.path
                + "/%(title)s [%(height)sp-%(vcodec)s+%(acodec)s].%(ext)s"

            printReproCommand(
                url: urlString,
                formatValue: sel.formatValue,
                cookiesPath: cookiesPath,
                outputTemplate: outTmpl,
                proxy: proxy
            )

            _ = YDLHelperSocket.shared.startDownload(
                taskID: taskId,
                url: urlString,
                formatValue: sel.formatValue,  // ★ 关键：精准传递 -f 的值
                outputTemplate: outTmpl,
                cookiesFile: cookiesPath,
                proxy: proxy,
                onEvent: { line in
                    Task { @MainActor in
                        DownloadCenter.shared.handleDownloadEvent(
                            line,
                            taskId: taskId
                        )
                    }
                },
                onClose: { [weak self] result in
                    Task { @MainActor in
                        switch result {
                        case .success:
                            // 可在此做收尾提示或状态同步
                            break
                        case .failure(let err):
                            self?.errorMessage =
                                "下载中断：\(err.localizedDescription)"
                            self?.showError = true
                        }
                    }
                }
            )
        }
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

            let proxy = await prepareProxy()

            let cookiesPath = cookiesFileURL().path

            let urlStr =
                c.sourceURL?.absoluteString
                ?? "https://www.youtube.com/watch?v=\(c.videoId)"

            if let info = YDLHelperSocket.shared.fetchVideoInfo(
                url: urlStr,
                videoID: c.videoId,
                cookiesFile: cookiesPath,
                proxy: proxy,
                timeout: 60
            ) {

                Task { @MainActor in
                    YTDLP.printSummary(info)
                    print("[Download] 成功获取格式: 共 \(info.formats.count) 个选项")
                    self.loading = false
                    let opts = UIFormatOption.fromYTDLPInfo(info)
                    UIFormatOption.debugPrintOptions(opts)  // 调试输出
                    self.formatOptions = opts
                    if let bestApple = opts.filter({
                        $0.compatibility == .apple
                    }).max(by: { $0.height < $1.height }) {
                        self.selectedFormatID = bestApple.id
                    } else {
                        // 如果没有 Apple 组，就退回到第一个
                        self.selectedFormatID = opts.first?.id
                    }
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

private extension ShowcaseViewModel {
    /// shell 参数安全转义（简单版）
    func shEscape(_ s: String) -> String {
        return "'" + s.replacingOccurrences(of: "'", with: "'\"'\"'") + "'"
    }

    /// 打印一条可直接复制到终端执行的 yt-dlp 命令
    func printReproCommand(
        url: String,
        formatValue: String,
        cookiesPath: String,
        outputTemplate: String,
        proxy: String?
    ) {
        var args: [String] = []
        args.append("yt-dlp")
        args.append(contentsOf: ["--cookies", cookiesPath])
        args.append(contentsOf: ["-f", formatValue])
        args.append(contentsOf: ["-o", outputTemplate])
        if let proxy, !proxy.isEmpty {
            args.append(contentsOf: ["--proxy", proxy])
        }
        args.append(url)

        let cmd = args.map { shEscape($0) }.joined(separator: " ")
        print(
            """
            [Debug] Repro cmd for terminal:
            \(cmd)
            """
        )
    }
}
