//
//  LibraryView.swift
//  TweetCatApp
//
//  Created by wesley on 2025/9/10.
//

import SwiftUI

struct LibraryView: View {
    @StateObject private var vm = LibraryViewModel()

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            listArea
        }
        .navigationTitle("已下载")
        .padding(.top, 6)
    }

    // MARK: - Header
    private var header: some View {
        HStack(spacing: 12) {
            Picker("分类", selection: $vm.segment) {
                ForEach(LibraryCategory.allCases) { c in
                    Text(c.rawValue).tag(c)
                }
            }
            .pickerStyle(.segmented)
            .frame(width: 220)

            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass")
                TextField("搜索 标题 / ID / 文件名", text: $vm.query)
                    .textFieldStyle(.roundedBorder)
                    .frame(minWidth: 260)
            }

            Spacer()

            Picker("排序", selection: $vm.sort) {
                ForEach(LibrarySort.allCases) { s in
                    Text(s.rawValue).tag(s)
                }
            }
            .frame(width: 220)
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
    }

    // MARK: - List
    private var listArea: some View {
        List {
            if vm.filteredAndSorted.isEmpty {
                emptyPlaceholder
            } else {
                ForEach(vm.filteredAndSorted) { it in
                    LibraryRowView(
                        item: it,
                        onPlay: { vm.play(it.id) },
                        onReveal: { vm.reveal(it.id) },
                        onDelete: { deleteFile(it: it) },
                        onMove: { vm.moveToOtherCategory(it.id) }
                    )
                }
            }
        }
        .listStyle(.inset)
    }

    func deleteFile(it: LibraryItem) {
        GlobalAlertManager.shared.show(
            title: "确认删除",
            message: "确定要删除《\(it.title)》吗？",
            onConfirm: {
                GlobalAlertManager.shared.show(
                    title: "删除方式",
                    message: "是否同时删除磁盘上的视频文件？",
                    onConfirm: { vm.delete(it.id, alsoDeleteFile: true) },
                    onCancel: { vm.delete(it.id, alsoDeleteFile: false) }
                )
            }
        )
    }

    private var emptyPlaceholder: some View {
        VStack(spacing: 8) {
            Image(systemName: "tray")
                .font(.system(size: 48))
                .foregroundStyle(.secondary)
            Text("暂无内容")
                .font(.headline)
            Text("这里将显示 \(vm.segment.rawValue) 下载到本地的文件。")
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .center)
        .padding(.vertical, 48)
    }
}

private struct LibraryRowView: View {
    let item: LibraryItem
    let onPlay: () -> Void
    let onReveal: () -> Void
    let onDelete: () -> Void
    let onMove: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            AsyncImage(url: item.thumbURL) { phase in
                switch phase {
                case .empty:
                    Rectangle().fill(.gray.opacity(0.1))
                        .frame(width: 120, height: 68)
                        .overlay { ProgressView() }
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                case .success(let image):
                    image.resizable().scaledToFill()
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
                Text(item.title)
                    .font(.headline)
                    .lineLimit(2)
                Text("\(item.videoId) • \(item.fileName)")
                    .font(.callout)
                    .foregroundStyle(.secondary)

                Text("\(item.fileSizeMB) MB • \(dateString(item.createdAt))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            HStack {
                Button("播放", action: onPlay)
                Button("在 Finder 中显示", action: onReveal)
                Menu("更多") {
                    Button(
                        item.category == .watch ? "移动到 Shorts" : "移动到 Watch",
                        action: onMove
                    )
                    Divider()
                    Button("删除", role: .destructive, action: onDelete)
                }
            }
        }
        .padding(.vertical, 6)
        .contextMenu {
            Button("播放", action: onPlay)
            Button("在 Finder 中显示", action: onReveal)
            Divider()
            Button(
                item.category == .watch ? "移动到 Shorts" : "移动到 Watch",
                action: onMove
            )
            Divider()
            Button("删除", role: .destructive, action: onDelete)
        }
    }

    private func dateString(_ d: Date) -> String {
        let f = DateFormatter()
        f.dateStyle = .medium
        f.timeStyle = .short
        return f.string(from: d)
    }
}
