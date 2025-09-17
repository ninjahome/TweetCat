using System.Windows.Controls;
using TweetCat.App.Win.ViewModels;
using TweetCat.Core.Services;

namespace TweetCat.App.Win.Views;

public partial class ShowcaseView : UserControl
{
    public ShowcaseViewModel ViewModel { get; }

    public ShowcaseView(IDownloadRepository repository, IYdlServiceClient ydl, NativeBridgeServer bridge, INotificationService notifications)
    {
        InitializeComponent();
        _ = repository;
        _ = bridge;
        ViewModel = new ShowcaseViewModel(ydl, notifications);
        DataContext = ViewModel;
    }
}
