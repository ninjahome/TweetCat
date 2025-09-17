using System.Windows.Controls;
using TweetCat.App.Win.ViewModels;
using TweetCat.App.Win.Services;

namespace TweetCat.App.Win.Views;

public partial class SettingsView : UserControl
{
    public SettingsViewModel ViewModel { get; }

    public SettingsView(DownloadRepository repository, NativeBridgeServer bridge)
    {
        InitializeComponent();
        ViewModel = new SettingsViewModel(repository, bridge);
        DataContext = ViewModel;
    }
}
