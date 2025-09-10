//
//  NetworkInspectorViewModel.swift
//  TweetCatApp
//
//  Created by wesley on 2025/9/10.
//

import Foundation

@MainActor
final class NetworkInspectorViewModel: ObservableObject {
    @Published var status: NetworkStatus? = nil
    @Published var loading: Bool = false
    private let inspector = NetworkInspector()

    func refresh() {
        loading = true
        Task {
            let s = await inspector.detect()
            status = s
            loading = false
        }
    }
}
