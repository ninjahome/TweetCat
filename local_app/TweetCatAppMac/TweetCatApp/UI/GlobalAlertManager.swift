//
//  GlobalAlertManager.swift
//  TweetCatApp
//
//  Created by wesley on 2025/9/13.
//

import SwiftUI

// MARK: - Manager
@MainActor
class GlobalAlertManager: ObservableObject {
    static let shared = GlobalAlertManager()

    @Published var isPresented: Bool = false
    @Published var title: String = ""
    @Published var message: String = ""

    private var onConfirm: (() -> Void)?
    private var onCancel: (() -> Void)?

    func show(
        title: String,
        message: String,
        onConfirm: @escaping () -> Void,
        onCancel: (() -> Void)? = nil
    ) {
        // ✅ 确保 UI 更新在下一帧执行，避免和 SwiftUI 渲染冲突
        DispatchQueue.main.async {
            self.title = title
            self.message = message
            self.onConfirm = onConfirm
            self.onCancel = onCancel
            self.isPresented = true
        }
    }

    func confirm() {
        isPresented = false
        onConfirm?()
        clearCallbacks()
    }

    func cancel() {
        isPresented = false
        onCancel?()
        clearCallbacks()
    }

    private func clearCallbacks() {
        onConfirm = nil
        onCancel = nil
    }
}

// MARK: - Global Alert View
struct GlobalAlertView: View {
    @StateObject private var manager = GlobalAlertManager.shared

    var body: some View {
        // ✅ 用 Color.clear，而不是 EmptyView，确保在视图树中有节点
        Color.clear
            .alert(manager.title, isPresented: $manager.isPresented) {
                Button("取消", role: .cancel) { manager.cancel() }
                Button("确认", role: .destructive) { manager.confirm() }
            } message: {
                Text(manager.message)
            }
    }
}
