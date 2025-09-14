//
//  GlobalAlertManager.swift
//  TweetCatApp
//
//  Created by wesley on 2025/9/14.
//

import SwiftUI

@MainActor
class GlobalAlertManager: ObservableObject {
    static let shared = GlobalAlertManager()

    // 是否显示
    @Published var isPresented: Bool = false
    // 提示标题 & 消息
    @Published var title: String = ""
    @Published var message: String = ""
    // 确认/取消回调
    private var onConfirm: (() -> Void)?
    private var onCancel: (() -> Void)?

    func show(
        title: String,
        message: String,
        onConfirm: @escaping () -> Void,
        onCancel: (() -> Void)? = nil
    ) {
        self.title = title
        self.message = message
        self.onConfirm = onConfirm
        self.onCancel = onCancel
        self.isPresented = true
    }

    func confirm() {
        isPresented = false
        onConfirm?()
        onConfirm = nil
        onCancel = nil
    }

    func cancel() {
        isPresented = false
        onCancel?()
        onConfirm = nil
        onCancel = nil
    }
}

struct GlobalAlertView: View {
    @ObservedObject var manager = GlobalAlertManager.shared

    var body: some View {
        EmptyView()
            .alert(manager.title, isPresented: $manager.isPresented) {
                Button("取消", role: .cancel) {
                    manager.cancel()
                }
                Button("确认", role: .destructive) {
                    manager.confirm()
                }
            } message: {
                Text(manager.message)
            }
    }
}
