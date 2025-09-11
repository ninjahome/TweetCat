//
//  ProgressViewTC.swift
//  TweetCatApp
//
//  Created by wesley on 2025/9/10.
//

import SwiftUI

struct ProgressViewTC: View {
    @StateObject private var vm = ProgressViewModelMock()

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
            Picker("筛选", selection: $vm.filter) {
                ForEach(ProgressViewModelMock.Filter.allCases) {
                    f in
                    Text(f.rawValue).tag(f)
                }
            }
            .pickerStyle(.segmented)
            .frame(width: 360)

            Spacer()

            Button {
                // 演示：再塞一个排队的假任务
                let new = MockDownloadTask(
                    title:
                        "新的假任务 \(Int.random(in: 100...999))",
                    videoId: UUID().uuidString.prefix(6)
                        .description,
                    thumbURL: URL(
                        string:
                            "https://via.placeholder.com/160x90.png?text=NEW"
                    ),
                    formatSummary: "Best/mp4",
                    state: .queued,
                    progress: 0,
                    speedText: nil,
                    etaText: nil,
                    downloadedText: nil,
                    errorMessage: nil
                )
                vm.items.insert(new, at: 0)
            } label: {
                Label("添加假任务", systemImage: "plus.circle")
            }
            .buttonStyle(.bordered)
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
    }

    private var listArea: some View {
        List {
            ForEach(vm.filteredItems) { item in
                TaskRowView(
                    item: item,
                    onPause: { vm.pause(item.id) },
                    onResume: { vm.resume(item.id) },
                    onCancel: { vm.cancel(item.id) },
                    onRetry: { vm.retry(item.id) },
                    onReveal: { vm.revealInFinder(item.id) }
                )
            }
        }
        .listStyle(.inset)
    }
}

private struct TaskRowView: View {
    let item: MockDownloadTask
    let onPause: () -> Void
    let onResume: () -> Void
    let onCancel: () -> Void
    let onRetry: () -> Void
    let onReveal: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 12) {
                AsyncImage(url: item.thumbURL) { phase in
                    switch phase {
                    case .empty:
                        Rectangle().fill(
                            .gray.opacity(0.1)
                        )
                        .frame(width: 120, height: 68)
                        .overlay { ProgressView() }
                        .clipShape(
                            RoundedRectangle(
                                cornerRadius: 8
                            )
                        )
                    case .success(let image):
                        image.resizable().scaledToFill()
                            .frame(
                                width: 120,
                                height: 68
                            )
                            .clipShape(
                                RoundedRectangle(
                                    cornerRadius:
                                        8
                                )
                            )
                    case .failure:
                        Image(systemName: "photo")
                            .frame(
                                width: 120,
                                height: 68
                            )
                            .background(
                                .gray.opacity(
                                    0.1
                                )
                            )
                            .clipShape(
                                RoundedRectangle(
                                    cornerRadius:
                                        8
                                )
                            )
                    @unknown default:
                        EmptyView()
                    }
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text(item.title)
                        .font(.headline)
                        .lineLimit(2)
                    Text(
                        "\(item.videoId) • \(item.formatSummary)"
                    )
                    .font(.callout)
                    .foregroundStyle(.secondary)

                    // 进度条 + 速度/ETA/大小
                    HStack(spacing: 8) {
                        ProgressView(
                            value: item.progress
                        )
                        .frame(width: 220)
                        if let speed = item.speedText {
                            Label(
                                speed,
                                systemImage:
                                    "bolt.fill"
                            )
                            .labelStyle(
                                .titleAndIcon
                            )
                            .font(.caption)
                            .foregroundStyle(
                                .secondary
                            )
                        }
                        if let eta = item.etaText {
                            Label(
                                eta,
                                systemImage:
                                    "clock"
                            )
                            .font(.caption)
                            .foregroundStyle(
                                .secondary
                            )
                        }
                        if let dl = item.downloadedText {
                            Text(dl).font(.caption)
                                .foregroundStyle(
                                    .secondary
                                )
                        }
                    }

                    // 状态/错误
                    if item.state == .failed,
                        let err = item.errorMessage
                    {
                        Text("错误：\(err)")
                            .font(.caption)
                            .foregroundStyle(.red)
                    } else {
                        Text(item.state.rawValue)
                            .font(.caption)
                            .foregroundStyle(
                                .secondary
                            )
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
        switch item.state {
        case .queued:
            HStack {
                Button("开始", action: onResume)
                Button("取消", action: onCancel).foregroundStyle(
                    .red
                )
            }
        case .running:
            HStack {
                Button("暂停", action: onPause)
                Button("取消", action: onCancel).foregroundStyle(
                    .red
                )
            }
        case .paused:
            HStack {
                Button("继续", action: onResume)
                Button("取消", action: onCancel).foregroundStyle(
                    .red
                )
            }
        case .merging:
            HStack {
                ProgressView().controlSize(.small)
                Text("合并中…").font(.caption).foregroundStyle(
                    .secondary
                )
            }
        case .done:
            HStack {
                Button("在 Finder 中显示", action: onReveal)
            }
        case .failed:
            HStack {
                Button("重试", action: onRetry)
                Button("删除", action: onCancel).foregroundStyle(
                    .red
                )
            }
        }
    }
}
