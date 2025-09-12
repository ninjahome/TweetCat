//
//  ProgressViewTC.swift
//  TweetCatApp
//
//  Created by wesley on 2025/9/10.
//

import SwiftUI

struct ProgressViewTC: View {
    @EnvironmentObject var downloadCenter: DownloadCenter

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
                    onPause: {},
                    onResume: {},
                    onCancel: {},
                    onRetry: {},
                    onReveal: {}
                )
            }
        }
        .listStyle(.inset)
    }
}

private struct TaskRowView: View {
    let task: DownloadTask
    let onPause: () -> Void
    let onResume: () -> Void
    let onCancel: () -> Void
    let onRetry: () -> Void
    let onReveal: () -> Void

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
                Button("开始", action: onResume)
                Button("取消", action: onCancel).foregroundStyle(.red)
            }
        case .running:
            HStack {
                Button("暂停", action: onPause)
                Button("取消", action: onCancel).foregroundStyle(.red)
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
                Button("在 Finder 中显示", action: onReveal)
            }
        case .failed:
            HStack {
                Button("重试", action: onRetry)
                Button("删除", action: onCancel).foregroundStyle(.red)
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
        }
    }
}
