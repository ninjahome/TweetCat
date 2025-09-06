//
//  Consts.swift
//  TweetCatApp
//
//  Created by wesley on 2025/9/6.
//

import Foundation

/// 全局固定 cookie 文件路径（App 内统一使用）
/// 指向：~/Library/Application Support/TweetCat/cookies.txt
public let kTweetCatCookieFile: String = {
        // 找到 Application Support 目录
        let base = FileManager.default.urls(
                for: .applicationSupportDirectory,
                in: .userDomainMask
        ).first!

        // 确保 ~/Library/Application Support/TweetCat 目录存在
        let dir = base.appendingPathComponent("TweetCat", isDirectory: true)
        try? FileManager.default.createDirectory(
                at: dir,
                withIntermediateDirectories: true,
                attributes: [.posixPermissions: 0o700]  // 目录权限收紧
        )

        // 拼接 cookie 文件路径
        let fileURL = dir.appendingPathComponent("cookies.txt")

        // 如果文件不存在，先创建一个空文件并设置权限
        if !FileManager.default.fileExists(atPath: fileURL.path) {
                FileManager.default.createFile(
                        atPath: fileURL.path,
                        contents: nil,
                        attributes: [.posixPermissions: 0o600]
                )
        } else {
                // 确保权限收紧为 0600
                try? FileManager.default.setAttributes(
                        [.posixPermissions: 0o600],
                        ofItemAtPath: fileURL.path
                )
        }

        return fileURL.path
}()
