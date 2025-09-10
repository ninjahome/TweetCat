//
//  ShowcaseView.swift
//  TweetCatApp
//
//  Created by wesley on 2025/9/10.
//

import SwiftUI

struct ShowcaseView: View {
    @EnvironmentObject private var appState: AppState
    @StateObject private var vm = ShowcaseViewModelMock()

    @State private var showAlert = false
    @State private var alertTitle = ""
    @State private var alertMessage = ""

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            content
        }
        .navigationTitle("展示")
        .toolbar {
            ToolbarItemGroup(placement: .automatic) {
                Button {
                    vm.simulateIncomingCandidate()
                } label: {
                    Label("模拟候选", systemImage: "sparkles")
                }
            }
        }
        .sheet(isPresented: $vm.showFormatSheet) {
            FormatSheetView(
                options: vm.formatOptions,
                selectedID: $vm.selectedFormatID,
                onCancel: { vm.showFormatSheet = false },
                onConfirm: {
                    let result = vm.startDownloadSelected()
                    alertTitle = result.title
                    alertMessage = result.message
                    vm.showFormatSheet = false
                    showAlert = true
                }
            )
            .frame(minWidth: 640, minHeight: 420)
        }

        .alert(alertTitle, isPresented: $showAlert) {
            Button("好") {}
        } message: {
            Text(alertMessage)
        }
    }

    // MARK: - Header
    private var header: some View {
        HStack {
            Text("来自浏览器扩展的候选视频")
                .font(.headline)
            Spacer()
            if vm.current != nil {
                Button {
                    vm.fetchFormats()
                } label: {
                    Label(
                        "获取/下载",
                        systemImage:
                            "arrow.down.circle.fill"
                    )
                }
                .buttonStyle(.borderedProminent)
            }
        }
        .padding(.horizontal)
        .padding(.vertical, 10)
    }

    // MARK: - Content
    private var content: some View {
        Group {
            if let c = vm.current {
                candidateCard(c)
            } else {
                emptyState
            }
        }
        .frame(
            maxWidth: .infinity,
            maxHeight: .infinity,
            alignment: .top
        )
        .padding()
    }

    // 候选卡片
    private func candidateCard(_ c: UIVideoCandidate) -> some View {
        HStack(alignment: .top, spacing: 16) {
            AsyncImage(url: c.thumbnailURL) { phase in
                switch phase {
                case .empty:
                    ZStack { ProgressView() }.frame(
                        width: 320,
                        height: 180
                    )
                    .background(Color.gray.opacity(0.1))
                    .clipShape(
                        RoundedRectangle(
                            cornerRadius: 12
                        )
                    )
                case .success(let image):
                    image.resizable().scaledToFill()
                        .frame(width: 320, height: 180)
                        .clipped()
                        .clipShape(
                            RoundedRectangle(
                                cornerRadius: 12
                            )
                        )
                case .failure:
                    ZStack {
                        Image(systemName: "photo")
                        Text("缩略图加载失败").font(.caption2)
                    }
                    .frame(width: 320, height: 180)
                    .background(Color.gray.opacity(0.1))
                    .clipShape(
                        RoundedRectangle(
                            cornerRadius: 12
                        )
                    )
                @unknown default:
                    EmptyView()
                }
            }.id(c.thumbnailURL?.absoluteString ?? "no-thumb")

            VStack(alignment: .leading, spacing: 8) {
                Text(c.title)
                    .font(.title3).bold()
                    .lineLimit(2)
                HStack(spacing: 8) {
                    Label(c.videoId, systemImage: "number")
                        .font(.callout)
                    if let sec = c.durationSec {
                        Label(
                            "\(sec) 秒",
                            systemImage: "clock"
                        ).font(.callout)
                    }
                }
                .foregroundStyle(.secondary)

                if let url = c.sourceURL {
                    Link(destination: url) {
                        Label(
                            "在浏览器中打开",
                            systemImage: "safari"
                        )
                    }
                    .font(.callout)
                }

                Spacer(minLength: 8)

                HStack(spacing: 12) {
                    Button {
                        vm.fetchFormats()
                    } label: {
                        Label(
                            "获取/下载",
                            systemImage:
                                "arrow.down.circle.fill"
                        )
                        .frame(minWidth: 120)
                    }
                    .buttonStyle(.borderedProminent)

                    Button {
                        vm.current = nil
                    } label: {
                        Label(
                            "清除",
                            systemImage:
                                "xmark.circle"
                        )
                    }
                    .buttonStyle(.bordered)
                }
            }
            Spacer()
        }
        .padding(16)
        .background(.thinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .shadow(radius: 1).id(c.id)
    }

    // 空状态（无扩展消息）
    private var emptyState: some View {
        VStack(spacing: 16) {
            Image(systemName: "puzzlepiece.extension")
                .font(.system(size: 64))
                .padding(12)
            Text("等待浏览器扩展的消息")
                .font(.title3).bold()
            Text("请先安装并启用 TweetCat 浏览器扩展，并在 YouTube 登录后选择一个视频。")
                .foregroundStyle(.secondary)
            HStack(spacing: 12) {
                Button {
                    // 这里仅演示；后续可打开真实扩展商店链接
                } label: {
                    Label(
                        "下载扩展",
                        systemImage:
                            "square.and.arrow.down"
                    )
                }
                .buttonStyle(.borderedProminent)

                Button {
                    // 这里仅演示；后续可跳转到内置帮助页
                } label: {
                    Label(
                        "查看安装指南",
                        systemImage:
                            "questionmark.circle"
                    )
                }
                .buttonStyle(.bordered)
            }

            Divider().padding(.vertical, 8)
            Button {
                vm.simulateIncomingCandidate()
            } label: {
                Label("模拟：注入一条候选", systemImage: "bolt.fill")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// 预览
#Preview {
    ShowcaseView()
        .environmentObject(AppState())
}
