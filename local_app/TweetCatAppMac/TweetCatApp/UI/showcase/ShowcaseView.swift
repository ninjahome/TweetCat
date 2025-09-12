//
//  ShowcaseView.swift
//  TweetCatApp
//
//  Created by wesley on 2025/9/10.
//

import SwiftUI

struct ShowcaseView: View {
    @EnvironmentObject private var appState: AppState
    @StateObject private var vm = ShowcaseViewModel()

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
        }.alert("错误", isPresented: $vm.showError) {
            Button("好") {}
        } message: {
            Text(vm.errorMessage ?? "未知错误")
        }
        .overlay {
            if vm.loading {
                ZStack {
                    Color.black.opacity(0.3).ignoresSafeArea()
                    VStack(spacing: 12) {
                        ProgressView("正在获取视频下载信息，请稍等…")
                            .progressViewStyle(CircularProgressViewStyle())
                            .padding()
                            .background(.thinMaterial)
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                    }
                }
            }
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
                    vm.fetchFormatsReal()
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
        let isShorts = c.sourceURL?.absoluteString.contains("/shorts/") ?? false

        return VStack(alignment: .center, spacing: 12) {
            // 缩略图
            thumbnailView(for: c, isShorts: isShorts)

            // 视频信息
            infoView(for: c)

            // 操作按钮
            actionButtons()
        }
        .padding(16)
        .background(.thinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .shadow(radius: 1)
        .id(c.id)
    }

    // MARK: - 缩略图视图
    @ViewBuilder
    private func thumbnailView(for c: UIVideoCandidate, isShorts: Bool)
        -> some View
    {
        if isShorts {
            // Shorts：固定 9:16 比例，适合竖屏
            AsyncImage(url: c.thumbnailURL) { phase in
                switch phase {
                case .empty:
                    ProgressView()
                        .frame(width: 240, height: 426)
                case .success(let image):
                    image.resizable()
                        .scaledToFill()
                        .frame(width: 240, height: 426)
                        .clipped()
                case .failure:
                    Color.gray.opacity(0.2)
                        .overlay(Image(systemName: "photo"))
                        .frame(width: 240, height: 426)
                @unknown default:
                    EmptyView()
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 12))
        } else {
            // Watch：宽度撑满，保持 16:9
            AsyncImage(url: c.thumbnailURL) { phase in
                switch phase {
                case .empty:
                    ProgressView()
                        .frame(maxWidth: .infinity)
                        .aspectRatio(16 / 9, contentMode: .fit)
                case .success(let image):
                    image.resizable()
                        .scaledToFit()
                        .frame(maxWidth: .infinity)
                        .aspectRatio(16 / 9, contentMode: .fit)
                case .failure:
                    Color.gray.opacity(0.2)
                        .overlay(Image(systemName: "photo"))
                        .frame(maxWidth: .infinity)
                        .aspectRatio(16 / 9, contentMode: .fit)
                @unknown default:
                    EmptyView()
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 12))
        }
    }

    // MARK: - 视频信息视图
    @ViewBuilder
    private func infoView(for c: UIVideoCandidate) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(c.title)
                .font(.title3).bold()
                .lineLimit(2)

            HStack(spacing: 8) {
                Label(c.videoId, systemImage: "number")
                    .font(.callout)
                if let sec = c.durationSec {
                    Label("\(sec) 秒", systemImage: "clock")
                        .font(.callout)
                }
            }
            .foregroundStyle(.secondary)

            if let url = c.sourceURL {
                Link(destination: url) {
                    Label("在浏览器中打开", systemImage: "safari")
                }
                .font(.callout)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - 操作按钮视图
    @ViewBuilder
    private func actionButtons() -> some View {
        HStack(spacing: 20) {
            Button {
                vm.fetchFormatsReal()
            } label: {
                Label("获取/下载", systemImage: "arrow.down.circle.fill")
                    .frame(minWidth: 120)
            }
            .buttonStyle(.borderedProminent)

            Button {
                vm.current = nil
            } label: {
                Label("清除", systemImage: "xmark.circle")
                    .frame(minWidth: 80)
            }
            .buttonStyle(.bordered)
        }
        .padding(.top, 12)
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
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// 预览
#Preview {
    ShowcaseView()
        .environmentObject(AppState())
}
