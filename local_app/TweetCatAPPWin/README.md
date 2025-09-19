# TweetCat Windows Companion

TweetCatAPPWin 提供与 macOS 版本相同的核心能力：

* 作为浏览器原生消息宿主，为 TweetCat 浏览器扩展提供登录唤起、Cookies 同步以及视频元数据推送。
* 拉起并监控封装好的 `tweetcat_ydl_server`，向下载中心流式传递 yt-dlp 事件，驱动 UI 下载列表和资料库。
* 暴露与 macOS 版对齐的 Sidebar + Showcase + 下载管理 + 资料库 + 设置视图模型，使桌面端体验保持一致。

该目录采用 .NET 8 + WPF + MVVM 架构，配合一个独立的原生消息宿主控制台程序和共享的 Core 库，还包含 MSIX 打包草案与注册表脚本。

## 目录结构

```
TweetCatAPPWin/
├── README.md                      # 本文件
├── TweetCatAppWin.sln             # Visual Studio 解决方案
├── resources/
│   ├── cookies/                   # Cookies 存储位置示例
│   └── python/                    # 放置打包后的 tweetcat_ydl_server 及 ffmpeg
├── packaging/
│   ├── install.ps1                # 安装/注册原生消息宿主示例脚本
│   └── native-messaging-manifest.json # Chrome/Edge manifest 模板
└── src/
    ├── TweetCat.Core/             # 共享模型、协议与服务接口
    ├── TweetCat.App.Win/          # WPF UI + 下载/资料库实现
    └── TweetCat.NativeMessagingHost/  # 原生消息宿主控制台
```

## 开发环境

* Windows 11 + Visual Studio 2022 (17.8+) 带 `.NET 桌面开发` 与 `MSIX 打包` 工作负载。
* .NET 8 SDK。
* Python 3.11 x64（用于在开发时运行 `tweetcat_ydl_server`，发布时可使用 PyInstaller 打包）。

## 快速开始

1. 将 macOS 版本打包好的 `tweetcat_ydl_server`、`yt-dlp`、`ffmpeg.exe` 拷贝到 `resources/python`。
2. 在 Visual Studio 中打开 `TweetCatAppWin.sln`，设置 `TweetCat.App.Win` 为启动项目。
3. 首次启动会自动创建 `%AppData%/TweetCat/` 目录、复制 cookies 模板并尝试启动 Python 服务。
4. 安装浏览器扩展并运行 `packaging/install.ps1` 写入注册表/manifest，即可从扩展唤起 Windows 客户端。

## TODO

* 集成 Windows App SDK 通知与应用生命周期。
* 完成 MSIX 打包脚本，提供自动更新。
* 将 macOS 中的日志/资料库数据迁移逻辑同步到 Windows。

