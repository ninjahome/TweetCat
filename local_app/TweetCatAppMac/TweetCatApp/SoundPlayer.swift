//
//  SoundPlayer.swift
//  TweetCatApp
//
//  Created by wesley on 2025/9/14.
//


import Foundation
import AVFoundation

final class SoundPlayer {
    static let shared = SoundPlayer()
    
    private var audioPlayer: AVAudioPlayer?
    
    private init() {}
    
    /// 播放成功音效
    func playSuccess() {
        playSound(named: "success")
    }
    
    /// 播放失败音效
    func playFail() {
        playSound(named: "fail")
    }
    
    /// 通用播放方法
    private func playSound(named name: String, fileExtension: String = "mp3") {
        guard let url = Bundle.main.url(forResource: name, withExtension: fileExtension) else {
            print("⚠️ 未找到音频文件: \(name).\(fileExtension)")
            return
        }
        
        do {
            audioPlayer = try AVAudioPlayer(contentsOf: url)
            audioPlayer?.prepareToPlay()
            audioPlayer?.play()
        } catch {
            print("⚠️ 播放音频失败: \(error)")
        }
    }
}
