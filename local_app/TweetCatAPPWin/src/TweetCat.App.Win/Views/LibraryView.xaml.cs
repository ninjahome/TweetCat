using System.Windows;
using System.Windows.Controls;
using TweetCat.App.Win.ViewModels;
using TweetCat.Core.Services;

namespace TweetCat.App.Win.Views;

public partial class LibraryView : UserControl
{
    public LibraryViewModel ViewModel { get; }

    public LibraryView(IDownloadRepository repository)
    {
        InitializeComponent();
        ViewModel = new LibraryViewModel(repository);
        DataContext = ViewModel;
        Loaded += OnLoaded;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        await ViewModel.InitializeAsync();
    }
}
