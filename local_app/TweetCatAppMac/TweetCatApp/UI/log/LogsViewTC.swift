//
//  LogsViewTC.swift
//  TweetCatApp
//
//  Created by wesley on 2025/9/10.
//

import SwiftUI

struct LogsViewTC: View {
    @StateObject private var vm = LogsCenter.shared.vm
    @State private var scrollToBottomToggle = false  // 用于触发 ScrollViewReader 滚动
    @State private var showExportAlert = false

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            logArea
            Divider()
            footer
        }
        .navigationTitle("日志")
        .padding(.top, 6)
        .onChange(of: vm.lines.count) { oldValue, newValue in
            // 新行到达时，如果开启自动滚动且未暂停，则滚动到底部
            if vm.autoScroll && !vm.paused {
                scrollToBottomToggle.toggle()
            }
        }
        .alert(
            "导出",
            isPresented: $showExportAlert,
            actions: {
                Button("好", role: .cancel) {}
            },
            message: {
                Text(vm.exportedPath ?? "已导出")
            }
        )
    }

    // MARK: - Header
    private var header: some View {
        HStack(spacing: 12) {
            Picker("来源", selection: $vm.sourceFilter) {
                ForEach(LogsViewModel.SourceFilter.allCases) { s in
                    Text(s.rawValue).tag(s)
                }
            }
            .frame(width: 180)

            Picker("级别", selection: $vm.levelFilter) {
                ForEach(LogsViewModel.LevelFilter.allCases) { l in
                    Text(l.rawValue).tag(l)
                }
            }
            .frame(width: 160)

            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass")
                TextField("搜索（消息 / 来源 / 级别 / 任务ID）", text: $vm.query)
                    .textFieldStyle(.roundedBorder)
                    .frame(minWidth: 280)
            }

            Spacer()

            Toggle("自动滚动", isOn: $vm.autoScroll)
                .toggleStyle(.switch)
                .frame(width: 120)

            Toggle("暂停流", isOn: $vm.paused)
                .toggleStyle(.switch)
                .frame(width: 120)
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
    }

    // MARK: - Log area
    private var logArea: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 2) {
                    ForEach(vm.filtered) { line in
                        LogLineView(line: line)
                            .id(line.id)
                    }
                    // 锚点：滚动到底部用
                    Color.clear
                        .frame(height: 1)
                        .id("BOTTOM")
                }
                .padding(.horizontal)
                .padding(.vertical, 8)
            }
            .onChange(of: scrollToBottomToggle) { oldValue, newValue in
                withAnimation(.linear(duration: 0.1)) {
                    proxy.scrollTo("BOTTOM", anchor: .bottom)
                }
            }
        }
    }

    // MARK: - Footer
    private var footer: some View {
        HStack(spacing: 12) {
            Button {
                vm.clear()
            } label: {
                Label("清空", systemImage: "trash")
            }

            Button {
                vm.copyAll()
            } label: {
                Label("复制全部", systemImage: "doc.on.doc")
            }

            Button {
                vm.exportAll()
                showExportAlert = true
            } label: {
                Label("导出为文本", systemImage: "square.and.arrow.down")
            }

            Spacer()

            Text("共 \(vm.filtered.count) 行")
                .foregroundStyle(.secondary)
                .font(.footnote)
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
    }
}

// 单行渲染
private struct LogLineView: View {
    let line: LogLine

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text("[\(timeString(line.time))]")
                .foregroundStyle(.secondary)
            Text(line.source.rawValue)
                .foregroundStyle(sourceColor)
            Text(line.level.rawValue.uppercased())
                .foregroundStyle(levelColor)
            if let tid = line.taskId {
                Text("[\(tid)]").foregroundStyle(.secondary)
            }
            Text("-")
            Text(line.message)
                .textSelection(.enabled)
            Spacer(minLength: 0)
        }
        .font(.system(.callout, design: .monospaced))
    }

    private var levelColor: Color {
        switch line.level {
        case .info: return .secondary
        case .warn: return .orange
        case .error: return .red
        }
    }

    private var sourceColor: Color {
        switch line.source {
        case .ui: return .blue
        case .host: return .teal
        case .ytdlp: return .purple
        }
    }

    private func timeString(_ d: Date) -> String {
        let f = DateFormatter()
        f.dateFormat = "HH:mm:ss.SSS"
        return f.string(from: d)
    }
}
