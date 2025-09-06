//
//  ProxyConfig.swift
//  TweetCatApp
//
//  Created by wesley on 2025/9/6.
//


struct ProxyConfig {
    static let vpn1: [String: String] = [
        "http_proxy": "socks5://127.0.0.1:31080",
        "https_proxy": "socks5://127.0.0.1:31080",
        "all_proxy": "socks5://127.0.0.1:31080"
    ]
    static let vpn2: [String: String] = [
        "http_proxy": "http://127.0.0.1:7890",
        "https_proxy": "http://127.0.0.1:7890",
        "all_proxy": "socks5://127.0.0.1:7890"
    ]
}
