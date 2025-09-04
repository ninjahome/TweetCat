//
//  Item.swift
//  TweetCatApp
//
//  Created by wesley on 2025/9/4.
//

import Foundation
import SwiftData

@Model
final class Item {
    var timestamp: Date
    
    init(timestamp: Date) {
        self.timestamp = timestamp
    }
}
