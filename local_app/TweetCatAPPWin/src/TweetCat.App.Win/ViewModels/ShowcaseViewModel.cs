using System.Collections.ObjectModel;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Input;
using TweetCat.App.Win.Commands;
using TweetCat.Core.Models;
using TweetCat.Core.Services;

namespace TweetCat.App.Win.ViewModels;

public sealed class ShowcaseViewModel : ViewModelBase
{
    private readonly IYdlServiceClient _ydl;
    private readonly INotificationService _notifications;
    private string _url = string.Empty;
    private VideoCandidate? _candidate;
    private YtdlpFormat? _selectedFormat;
    private bool _isBusy;

    public ShowcaseViewModel(IYdlServiceClient ydl, INotificationService notifications)
    {
        _ydl = ydl;
        _notifications = notifications;
        Formats = new ObservableCollection<YtdlpFormat>();
        QueryCommand = new AsyncRelayCommand(_ => QueryAsync());
        DownloadCommand = new AsyncRelayCommand(_ => DownloadAsync(), _ => SelectedFormat != null && Candidate != null);
    }

    public ObservableCollection<YtdlpFormat> Formats { get; }

    public ICommand QueryCommand { get; }

    public ICommand DownloadCommand { get; }

    public string Url
    {
        get => _url;
        set => SetProperty(ref _url, value);
    }

    public VideoCandidate? Candidate
    {
        get => _candidate;
        private set
        {
            SetProperty(ref _candidate, value);
            Formats.Clear();
            if (value != null)
            {
                foreach (var format in value.Formats.OrderByDescending(f => f.Filesize ?? 0))
                {
                    Formats.Add(format);
                }
            }

            SelectedFormat = Formats.FirstOrDefault();
            (DownloadCommand as AsyncRelayCommand)?.RaiseCanExecuteChanged();
        }
    }

    public YtdlpFormat? SelectedFormat
    {
        get => _selectedFormat;
        set
        {
            SetProperty(ref _selectedFormat, value);
            (DownloadCommand as AsyncRelayCommand)?.RaiseCanExecuteChanged();
        }
    }

    public bool IsBusy
    {
        get => _isBusy;
        private set
        {
            SetProperty(ref _isBusy, value);
            (QueryCommand as AsyncRelayCommand)?.RaiseCanExecuteChanged();
        }
    }

    public void ApplyCandidate(VideoCandidate candidate)
    {
        Url = $"https://www.youtube.com/watch?v={candidate.VideoId}";
        Candidate = candidate;
    }

    private async Task QueryAsync()
    {
        if (string.IsNullOrWhiteSpace(Url))
        {
            return;
        }

        IsBusy = true;
        try
        {
            var metadata = await _ydl.QueryMetadataAsync(Url, CancellationToken.None);
            Candidate = metadata.FirstOrDefault();
        }
        finally
        {
            IsBusy = false;
        }
    }

    private async Task DownloadAsync()
    {
        if (Candidate == null || SelectedFormat == null)
        {
            return;
        }

        _notifications.ShowDownloadStarted(Candidate.Title);
        await _ydl.EnqueueDownloadAsync(Candidate, SelectedFormat, CancellationToken.None);
    }
}
