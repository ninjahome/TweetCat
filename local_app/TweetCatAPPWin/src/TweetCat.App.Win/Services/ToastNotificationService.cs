using System.Diagnostics;
using TweetCat.Core.Services;

namespace TweetCat.App.Win.Services;

public sealed class ToastNotificationService : INotificationService
{
    public void ShowDownloadStarted(string title)
    {
        Debug.WriteLine($"[Toast] 开始下载: {title}");
    }

    public void ShowDownloadCompleted(string title, string filePath)
    {
        Debug.WriteLine($"[Toast] 下载完成: {title} -> {filePath}");
    }

    public void ShowDownloadFailed(string title, string error)
    {
        Debug.WriteLine($"[Toast] 下载失败: {title} - {error}");
    }
}
