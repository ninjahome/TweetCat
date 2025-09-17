using System.Windows;
using System.Windows.Controls;
using TweetCat.App.Win.ViewModels;
using TweetCat.Core.Services;

namespace TweetCat.App.Win.Views;

public partial class DownloadCenterView : UserControl
{
    public DownloadCenterViewModel ViewModel { get; }

    public DownloadCenterView(IDownloadRepository repository, IYdlServiceClient ydl, INotificationService notifications)
    {
        InitializeComponent();
        ViewModel = new DownloadCenterViewModel(repository, ydl, notifications);
        DataContext = ViewModel;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        await ViewModel.InitializeAsync();
    }

    private async void OnUnloaded(object sender, RoutedEventArgs e)
    {
        await ViewModel.DisposeAsync();
    }
}
