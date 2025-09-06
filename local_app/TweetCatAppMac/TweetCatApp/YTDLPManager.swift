//
//  YTDLPManager.swift
//  TweetCatApp
//
//  Created by wesley on 2025/9/6.
//

import Foundation

final class YTDLPManager {
        static let shared = YTDLPManager()
        private var metaWorker: YTDLPWorker?

        func start(cookieFile: String = kTweetCatCookieFile) {
                let w = YTDLPWorker(kind: .meta, cookiesPath: cookieFile)
                w.spawn()
                metaWorker = w
        }

        func stop() {
                metaWorker?.stop()
                metaWorker = nil
        }

        func enqueueQuery(
                videoId: String,
                url: String,
                cookieFile: String = kTweetCatCookieFile,
                timeout: TimeInterval = 120,
                completion: @escaping (Result<YTDLP.YTDLPInfo, Error>) -> Void
        ) {
                if metaWorker == nil || metaWorker?.cookiesPath != cookieFile {
                        stop()
                        start(cookieFile: cookieFile)
                }
                metaWorker?.submitMeta(
                        url: url,
                        timeout: timeout,
                        completion: completion
                )
        }
}
