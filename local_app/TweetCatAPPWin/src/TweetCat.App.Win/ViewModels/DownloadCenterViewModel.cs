using System;
using System.Collections.ObjectModel;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Input;
using TweetCat.App.Win.Commands;
using TweetCat.Core.Models;
using TweetCat.Core.Services;

namespace TweetCat.App.Win.ViewModels;

public sealed class DownloadCenterViewModel : ViewModelBase, IAsyncDisposable
{
    private readonly IDownloadRepository _repository;
    private readonly IYdlServiceClient _ydl;
    private readonly INotificationService _notifications;
    private readonly CancellationTokenSource _cts = new();

    public DownloadCenterViewModel(IDownloadRepository repository, IYdlServiceClient ydl, INotificationService notifications)
    {
        _repository = repository;
        _ydl = ydl;
        _notifications = notifications;
        ActiveTasks = new ObservableCollection<DownloadTaskState>();
        CancelCommand = new AsyncRelayCommand(taskId => CancelAsync(taskId as string));
    }

    public ObservableCollection<DownloadTaskState> ActiveTasks { get; }

    public ICommand CancelCommand { get; }

    public async Task InitializeAsync()
    {
        var stored = await _repository.LoadActiveAsync(_cts.Token);
        foreach (var task in stored.OrderBy(t => t.CreatedAt))
        {
            ActiveTasks.Add(task);
        }

        _ = Task.Run(ProcessEventsAsync, _cts.Token);
    }

    public ValueTask DisposeAsync()
    {
        _cts.Cancel();
        _cts.Dispose();
        return ValueTask.CompletedTask;
    }

    private async Task ProcessEventsAsync()
    {
        try
        {
            await foreach (var update in _ydl.WatchProgressAsync(_cts.Token))
            {
                App.Current.Dispatcher.Invoke(() => ApplyUpdate(update));
                await _repository.SaveActiveAsync(ActiveTasks, _cts.Token);
            }
        }
        catch (OperationCanceledException)
        {
        }
    }

    private void ApplyUpdate(DownloadTaskState update)
    {
        var existing = ActiveTasks.FirstOrDefault(t => t.Id == update.Id);
        if (existing == null)
        {
            ActiveTasks.Add(update);
            return;
        }

        existing.Status = update.Status;
        existing.Progress = update.Progress;
        existing.Eta = update.Eta;
        existing.SpeedBytes = update.SpeedBytes;
        existing.CompletedAt = update.CompletedAt;
        existing.OutputPath = update.OutputPath;
        existing.Error = update.Error;

        if (update.Status == DownloadTaskStatus.Completed && update.OutputPath != null)
        {
            _notifications.ShowDownloadCompleted(update.Title, update.OutputPath);
            var entry = new LibraryEntry
            {
                Id = update.Id,
                Title = update.Title,
                FilePath = update.OutputPath,
                CreatedAt = update.CompletedAt ?? DateTimeOffset.UtcNow,
                SourceUrl = update.Id
            };
            _ = _repository.AddToLibraryAsync(entry, _cts.Token);
        }
        else if (update.Status == DownloadTaskStatus.Failed)
        {
            _notifications.ShowDownloadFailed(update.Title, update.Error ?? "未知错误");
        }
    }

    private async Task CancelAsync(string? taskId)
    {
        if (string.IsNullOrWhiteSpace(taskId))
        {
            return;
        }

        await _ydl.CancelAsync(taskId, _cts.Token);
    }
}
