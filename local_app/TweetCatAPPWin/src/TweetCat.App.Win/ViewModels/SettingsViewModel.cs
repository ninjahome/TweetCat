using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Input;
using TweetCat.App.Win.Commands;
using TweetCat.App.Win.Services;

namespace TweetCat.App.Win.ViewModels;

public sealed class SettingsViewModel : ViewModelBase
{
    private readonly DownloadRepository _repository;
    private readonly NativeBridgeServer _bridge;
    private DateTimeOffset? _lastPing;
    private string? _extensionVersion;
    private string? _manifestPath;

    public SettingsViewModel(DownloadRepository repository, NativeBridgeServer bridge)
    {
        _repository = repository;
        _bridge = bridge;
        _bridge.StatusChanged += OnStatusChanged;
        OpenCookiesCommand = new RelayCommand(_ => OpenFolder(repository.RootPath));
        RefreshStatusCommand = new RelayCommand(_ => OnStatusChanged(this, _bridge.CurrentStatus));
    }

    public ICommand OpenCookiesCommand { get; }

    public ICommand RefreshStatusCommand { get; }

    public string DataRoot => _repository.RootPath;

    public DateTimeOffset? LastPing
    {
        get => _lastPing;
        private set => SetProperty(ref _lastPing, value);
    }

    public string? ExtensionVersion
    {
        get => _extensionVersion;
        private set => SetProperty(ref _extensionVersion, value);
    }

    public string? ManifestPath
    {
        get => _manifestPath;
        private set => SetProperty(ref _manifestPath, value);
    }

    private void OnStatusChanged(object? sender, NativeBridgeStatus status)
    {
        LastPing = status.LastPing;
        ExtensionVersion = status.ExtensionVersion;
        ManifestPath = status.ManifestPath;
    }

    private static void OpenFolder(string path)
    {
        if (!Directory.Exists(path))
        {
            return;
        }

        Process.Start(new ProcessStartInfo
        {
            FileName = path,
            UseShellExecute = true
        });
    }
}
