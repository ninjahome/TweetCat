//
//  WaitOverlayManager.swift
//  TweetCatApp
//
//  Created by wesley on 2025/9/13.
//

import Combine
import SwiftUI

@MainActor
class WaitOverlayManager: ObservableObject {
    static let shared = WaitOverlayManager()

    @Published var isWaiting: Bool = false
    @Published var message: String? = nil

    private var hideTask: Task<Void, Never>?

    /// 显示等待界面
    func show(message: String? = nil, timeout: TimeInterval = 5.0) {
        self.message = message
        self.isWaiting = true

        // 启动超时任务
        hideTask?.cancel()
        hideTask = Task {
            try? await Task.sleep(nanoseconds: UInt64(timeout * 1_000_000_000))
            if !Task.isCancelled {
                await MainActor.run {
                    self.hide()
                }
            }
        }
    }

    /// 隐藏等待界面
    func hide() {
        DispatchQueue.main.async {
            self.isWaiting = false
            self.message = nil
        }

        hideTask?.cancel()
        hideTask = nil
    }
}

struct WaitOverlay: View {
    @ObservedObject var manager = WaitOverlayManager.shared

    var body: some View {
        if manager.isWaiting {
            ZStack {
                Color.black.opacity(0.3)
                    .ignoresSafeArea()
                VStack(spacing: 12) {
                    ProgressView()
                        .progressViewStyle(CircularProgressViewStyle())
                        .scaleEffect(1.5)
                    if let msg = manager.message {
                        Text(msg)
                            .foregroundColor(.white)
                            .font(.headline)
                    }
                }
                .padding(20)
                .background(Color.black.opacity(0.7))
                .cornerRadius(12)
            }
            .transition(.opacity)
            .animation(.easeInOut, value: manager.isWaiting)
        }
    }
}
