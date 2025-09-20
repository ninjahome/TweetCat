using System.Collections.ObjectModel;
using System.Linq;
using System.Windows.Controls;
using TweetCat.App.Win.Services;
using TweetCat.App.Win.Views;
using TweetCat.Core.Models;
using TweetCat.Core.Services;

namespace TweetCat.App.Win.ViewModels;

public sealed class MainViewModel : ViewModelBase
{
    private NavigationItemViewModel? _selectedNavigationItem;
    private UserControl? _selectedContent;

    public MainViewModel(IDownloadRepository repository, IYdlServiceClient ydl, INotificationService notifications, NativeBridgeServer bridge)
    {
        var showcase = new ShowcaseView(repository, ydl, bridge, notifications);
        var downloads = new DownloadCenterView(repository, ydl, notifications);
        var library = new LibraryView(repository);
        var settings = new SettingsView(repository, bridge);

        NavigationItems = new ObservableCollection<NavigationItemViewModel>
        {
            new("视频候选", showcase),
            new("下载中", downloads),
            new("资料库", library),
            new("设置", settings)
        };

        bridge.MetadataReceived += OnMetadataReceived;
        bridge.ActivateRequested += (_, _) => App.Current.Dispatcher.Invoke(() => App.Current.MainWindow?.Activate());

        SelectedNavigationItem = NavigationItems.First();
    }

    public ObservableCollection<NavigationItemViewModel> NavigationItems { get; }

    public NavigationItemViewModel? SelectedNavigationItem
    {
        get => _selectedNavigationItem;
        set
        {
            if (value == null)
            {
                return;
            }

            foreach (var item in NavigationItems)
            {
                item.IsSelected = item == value;
            }

            SetProperty(ref _selectedNavigationItem, value);
            SelectedContent = value.Content;
        }
    }

    public UserControl? SelectedContent
    {
        get => _selectedContent;
        private set => SetProperty(ref _selectedContent, value);
    }

    private void OnMetadataReceived(object? sender, VideoCandidate candidate)
    {
        if (NavigationItems.FirstOrDefault()?.Content is ShowcaseView showcase)
        {
            showcase.Dispatcher.Invoke(() => showcase.ViewModel.ApplyCandidate(candidate));
        }
    }
}
