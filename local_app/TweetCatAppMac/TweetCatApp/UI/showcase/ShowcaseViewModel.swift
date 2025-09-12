//
//  ShowcaseViewModelMock.swift
//  TweetCatApp
//
//  Created by wesley on 2025/9/10.
//

import Combine
import Foundation

final class ShowcaseViewModel: ObservableObject {
    @Published var current: UIVideoCandidate? = nil
    @Published var showFormatSheet: Bool = false
    @Published var formatOptions: [UIFormatOption] = []
    @Published var selectedFormatID: UIFormatOption.ID? = nil
    @Published var loading: Bool = false
    @Published var errorMessage: String? = nil
    @Published var showError: Bool = false

    private var bag = Set<AnyCancellable>()

    init() {
        NativeMessageReceiver.shared.$latestCandidate
            .receive(on: DispatchQueue.main)
            .sink { [weak self] cand in
                guard let self, let cand else { return }
                self.current = cand
            }
            .store(in: &bag)
    }

    func startDownloadSelected() -> (title: String, message: String) {
        guard let c = current else {
            return ("未选择视频", "请先接收扩展消息或点击“模拟候选”按钮。")
        }
        guard
            let sel = formatOptions.first(where: { $0.id == selectedFormatID })
        else {
            return ("未选择格式", "请选择一个下载格式后再开始。")
        }

        // 1) URL
        let urlString =
            c.sourceURL?.absoluteString
            ?? "https://www.youtube.com/watch?v=\(c.videoId)"

        Task {
            let proxy = await prepareProxy()

            let cookiesPath = cookiesFileURL().path
            let cat = (c.pageTyp.lowercased() == "shorts") ? "shorts" : "watch"
            let downloads = FileManager.default.homeDirectoryForCurrentUser
                .appendingPathComponent("Downloads", isDirectory: true)
                .appendingPathComponent("TweetCat", isDirectory: true)
                .appendingPathComponent(cat, isDirectory: true)

            // 确保目录存在
            try? FileManager.default.createDirectory(
                at: downloads,
                withIntermediateDirectories: true,
                attributes: nil
            )

            let outTmpl =
                downloads.path
                + "/%(title)s [%(height)sp-%(vcodec)s+%(acodec)s].%(ext)s"

            printReproCommand(
                url: urlString,
                formatValue: sel.formatValue,
                cookiesPath: cookiesPath,
                outputTemplate: outTmpl,
                proxy: proxy
            )

            _ = YDLHelperSocket.shared.startDownload(
                url: urlString,
                formatValue: sel.formatValue,  // ★ 关键：精准传递 -f 的值
                outputTemplate: outTmpl,
                cookiesFile: cookiesPath,
                proxy: proxy,
                onEvent: { [weak self] line in
                    Task { @MainActor in self?.handleDownloadEvent(line) }
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

        let info =
            "\(sel.kind.rawValue) • \(sel.resolution) • \(sel.container.uppercased())"
        return ("已开始下载", "《\(c.title)》\n\(info)")
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

            if let info = YDLHelperSocket.shared.fetchVideoInfo(
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

// MARK: - Proxy
private extension ShowcaseViewModel {
    /// 统一的代理准备逻辑：检测网络 → 生成 CLI 代理字符串。
    /// - Returns: 若可用则返回 CLI 代理形如 "socks5://127.0.0.1:1080"，否则返回 nil。
    func prepareProxy(manual: ManualProxyForm = ManualProxyForm()) async
        -> String?
    {
        let inspector = NetworkInspector()
        let status = await inspector.detect()
        print("[Network] 检测结果: \(status.note)")

        let proxyConfig = ProxyApplier.makeYTDLPProxyConfig(
            network: status,
            manual: manual
        )
        let cli = proxyConfig.cliProxyURL
        if let cli, !cli.isEmpty {
            print("[Network] 使用代理: \(cli)  env=\(proxyConfig.env)")
            return cli
        } else {
            print("[Network] 未使用代理（直连）")
            return nil
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

private extension ShowcaseViewModel {
    func handleDownloadEvent(_ line: String) {
        // 原始行
        print("[DL][raw] \(line)")

        // 解析
        guard
            let data = line.data(using: .utf8),
            let obj = try? JSONSerialization.jsonObject(with: data)
                as? [String: Any],
            let event = obj["event"] as? String
        else {
            print("[DL][warn] parse failed")
            return
        }

        // 统一头
        print("[DL][event] \(event)")
        // 也打印一份美化后的 JSON 供排查
        ppJSON(obj)

        switch event {
        case "start":
            // 可能包含 taskId / url / format_value 等
            let url = obj["url"] as? String
            let fmt = obj["format"] as? String ?? obj["format_value"] as? String
            print("[DL][start] url=\(url ?? "n/a") format=\(fmt ?? "n/a")")

        case "meta":
            // 期望有 title / id / duration 等
            let title = obj["title"] as? String
            let vid = obj["id"] as? String
            let dur = val(obj, "duration")
            print(
                "[DL][meta] title=\(title ?? "n/a") id=\(vid ?? "n/a") duration=\(dur.map { "\($0)s" } ?? "n/a")"
            )

        case "progress":
            // downloaded / total / percent / speed / eta / phase / filename
            let downloaded = val(obj, "downloaded")
            let total = val(obj, "total")
            let percent = val(obj, "percent")
            let speed = val(obj, "speed")
            let eta = val(obj, "eta")
            let phase = obj["phase"] as? String
            let filename = obj["filename"] as? String

            print(
                "[DL][progress] "
                    + "p=\(percent.map { String(format: "%.2f", $0) } ?? "n/a") "
                    + "dl=\(downloaded.map { String(format: "%.0f", $0) } ?? "n/a") "
                    + "tot=\(total.map { String(format: "%.0f", $0) } ?? "n/a") "
                    + "spd=\(speed.map { String(format: "%.1f", $0) } ?? "n/a") "
                    + "eta=\(eta.map { String(format: "%.0f", $0) } ?? "n/a") "
                    + "phase=\(phase ?? "n/a") " + "file=\(filename ?? "n/a")"
            )

        case "merging":
            // 一般会有 target / container / program(ffmpeg) 等
            let target = obj["target"] as? String
            let container = obj["container"] as? String
            let program = obj["program"] as? String
            print(
                "[DL][merging] target=\(target ?? "n/a") container=\(container ?? "n/a") program=\(program ?? "n/a")"
            )

        case "done":
            // 可能包含 filepath / filename / elapsed / filesize 等
            let filepath =
                obj["filepath"] as? String ?? obj["filename"] as? String
            let elapsed = val(obj, "elapsed")
            let size = val(obj, "filesize")
            print(
                "[DL][done] file=\(filepath ?? "n/a") elapsed=\(elapsed.map { "\($0)s" } ?? "n/a") size=\(size.map { String(format: "%.0f", $0) } ?? "n/a")"
            )

        case "error":
            // 可能是 { error: {code,message} } 或 { error: "..." }
            if let err = obj["error"] as? [String: Any] {
                let code =
                    err["code"] as? String ?? (err["errno"] as? String)
                    ?? (val(err, "code").map { "\($0)" })
                let msg =
                    err["message"] as? String ?? err["msg"] as? String
                    ?? "\(err)"
                print("[DL][error] code=\(code ?? "n/a") message=\(msg)")
            } else if let errStr = obj["error"] as? String {
                print("[DL][error] \(errStr)")
            } else {
                print("[DL][error] unknown payload")
            }

        default:
            print("[DL][info] unknown event: \(event)")
        }
    }

    // MARK: - Debug helpers (仅日志用)
    private func ppJSON(_ dict: [String: Any]) {
        guard
            let data = try? JSONSerialization.data(
                withJSONObject: dict,
                options: [.prettyPrinted, .withoutEscapingSlashes]
            ),
            let s = String(data: data, encoding: .utf8)
        else { return }
        print("[DL][json]\n\(s)")
    }

    private func val(_ dict: [String: Any], _ key: String) -> Double? {
        if let d = dict[key] as? Double { return d }
        if let n = dict[key] as? NSNumber { return n.doubleValue }
        if let s = dict[key] as? String, let d = Double(s) { return d }
        return nil
    }
}
