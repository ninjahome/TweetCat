using System;
using System.IO;
using System.Threading.Tasks;
using TweetCat.App.Win.ViewModels;
using TweetCat.Core.Services;

namespace TweetCat.App.Win.Services;

public sealed class AppBootstrapper : IAsyncDisposable
{
    private readonly DownloadRepository _repository;
    private readonly ToastNotificationService _notifications;
    private readonly YdlServiceClient _ydlClient;
    private readonly NativeBridgeServer _bridgeServer;
    private readonly MainWindow _window;

    public AppBootstrapper()
    {
        var appData = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "TweetCat");
        Directory.CreateDirectory(appData);

        _repository = new DownloadRepository(appData);
        _notifications = new ToastNotificationService();
        _ydlClient = new YdlServiceClient(Path.Combine(AppContext.BaseDirectory, "resources", "python"));
        _bridgeServer = new NativeBridgeServer();

        var mainViewModel = new MainViewModel(_repository, _ydlClient, _notifications, _bridgeServer);
        _window = new MainWindow { DataContext = mainViewModel };
    }

    public async Task InitializeAsync()
    {
        await _ydlClient.InitializeAsync();
        await _bridgeServer.StartAsync();
        _window.Show();
    }

    public async ValueTask DisposeAsync()
    {
        await _bridgeServer.DisposeAsync();
        await _ydlClient.DisposeAsync();
    }
}
