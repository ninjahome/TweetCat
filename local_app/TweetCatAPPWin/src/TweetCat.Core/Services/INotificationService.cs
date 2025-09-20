namespace TweetCat.Core.Services;

public interface INotificationService
{
    void ShowDownloadStarted(string title);

    void ShowDownloadCompleted(string title, string filePath);

    void ShowDownloadFailed(string title, string error);
}
