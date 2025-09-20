using System.Windows;
using TweetCat.App.Win.Services;

namespace TweetCat.App.Win;

public partial class App : Application
{
    private AppBootstrapper? _bootstrapper;

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        _bootstrapper = new AppBootstrapper();
        _bootstrapper.InitializeAsync().GetAwaiter().GetResult();
    }

    protected override void OnExit(ExitEventArgs e)
    {
        _bootstrapper?.DisposeAsync().AsTask().GetAwaiter().GetResult();
        base.OnExit(e);
    }
}
