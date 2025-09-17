//
//  ProgressViewTC.swift
//  TweetCatApp
//
//  Created by wesley on 2025/9/10.
//

import SwiftUI

struct ProgressViewTC: View {
    @ObservedObject var downloadCenter = DownloadCenter.shared

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            listArea
        }
        .navigationTitle("进度")
        .padding(.top, 6)
    }

    private var header: some View {
        HStack(spacing: 12) {
            Text("所有任务")
                .font(.headline)
            Spacer()
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
    }

    private var listArea: some View {
        List {
            ForEach(downloadCenter.items) { task in
                TaskRowView(
                    task: task,
                    onStop: { stopTask(taskID: task.id) },
                    onRemove: { removeTask(taskID: task.id) },
                    onRetry: { restartLoadVideo(taskID: task.id) }
                )
            }
        }
        .listStyle(.inset)
    }

    private func restartLoadVideo(taskID: String) {
        // 显示等待层
        WaitOverlayManager.shared.show(message: "正在启动任务", timeout: 5.0)

        Task {
            await DownloadCenter.shared.retryTask(taskID) { result in
                // 不管成功还是失败，都先隐藏等待层
                WaitOverlayManager.shared.hide()

                switch result {
                case .success:
                    print("任务 \(taskID) 重试成功")
                case .failure(let error):
                    GlobalAlertManager.shared.show(
                        title: "任务启动失败",
                        message: error.localizedDescription,
                        onConfirm: {}
                    )
                }
            }
        }
    }

    private func stopTask(taskID: String) {
        WaitOverlayManager.shared.show(message: "正在取消任务…", timeout: 5.0)
        YDLHelperSocket.shared.cancelTask(taskID: taskID)
    }

    private func removeTask(taskID: String) {
        GlobalAlertManager.shared.show(
            title: "确认删除",
            message: "你确定要删除这个任务吗？",
            onConfirm: {
                // 用户点击“确认”
                YDLHelperSocket.shared.cancelTask(taskID: taskID)
                DownloadCenter.shared.removeTaskData(taskID)
            },
            onCancel: {
                // 用户点击“取消”（可选）
                print("用户取消删除")
            }
        )
    }
}

private struct TaskRowView: View {
    let task: DownloadTask
    let onStop: () -> Void
    let onRemove: () -> Void
    let onRetry: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 12) {
                AsyncImage(url: task.thumbURL) { phase in
                    switch phase {
                    case .empty:
                        Rectangle()
                            .fill(.gray.opacity(0.1))
                            .frame(width: 120, height: 68)
                            .overlay { ProgressView() }
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                    case .success(let image):
                        image.resizable()
                            .scaledToFill()
                            .frame(width: 120, height: 68)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                    case .failure:
                        Image(systemName: "photo")
                            .frame(width: 120, height: 68)
                            .background(.gray.opacity(0.1))
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                    @unknown default:
                        EmptyView()
                    }
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text(task.title)
                        .font(.headline)
                        .lineLimit(2)

                    Text("\(task.videoId) • \(task.formatSummary)")
                        .font(.callout)
                        .foregroundStyle(.secondary)

                    // 进度条 + 速度/ETA/大小
                    HStack(spacing: 8) {
                        ProgressView(value: task.progress)
                            .frame(width: 220)

                        if !task.speedText.isEmpty {
                            Label(task.speedText, systemImage: "bolt.fill")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        if !task.etaText.isEmpty {
                            Label(task.etaText, systemImage: "clock")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        if !task.downloadedText.isEmpty {
                            Text(task.downloadedText)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }

                    // 状态 or 错误
                    if task.state == .failed, let err = task.errorMessage {
                        Text("错误：\(err)")
                            .font(.caption)
                            .foregroundStyle(.red)
                    } else {
                        Text(statusText(for: task.state))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                Spacer()

                controls
            }
        }
        .padding(.vertical, 6)
    }

    @ViewBuilder
    private var controls: some View {
        switch task.state {
        case .queued:
            HStack {
                Button("重试", action: onRetry)
                Button("删除", action: onRemove).foregroundStyle(.red)
            }
        case .running:
            HStack {
                Button("暂停", action: onStop)
                Button("删除", action: onRemove).foregroundStyle(.red)
            }
        case .merging:
            HStack {
                ProgressView().controlSize(.small)
                Text("合并中…")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

        case .done:
            HStack {
                Text("").hidden()
            }

        case .failed:
            HStack {
                Button("重试", action: onRetry)
                Button("删除", action: onRemove).foregroundStyle(.red)
            }

        case .cancelled:
            HStack {
                Button("重试", action: onRetry)
                Button("删除", action: onRemove).foregroundStyle(.red)
            }
        }
    }

    private func statusText(for state: DownloadState) -> String {
        switch state {
        case .queued: return "等待中"
        case .running: return "下载中"
        case .merging: return "合并中"
        case .done: return "已完成"
        case .failed: return "失败"
        case .cancelled: return "已取消"
        }
    }
}
