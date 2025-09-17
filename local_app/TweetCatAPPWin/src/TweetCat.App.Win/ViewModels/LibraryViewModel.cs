using System.Collections.ObjectModel;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Input;
using TweetCat.App.Win.Commands;
using TweetCat.Core.Models;
using TweetCat.Core.Services;

namespace TweetCat.App.Win.ViewModels;

public sealed class LibraryViewModel : ViewModelBase
{
    private readonly IDownloadRepository _repository;

    public LibraryViewModel(IDownloadRepository repository)
    {
        _repository = repository;
        Entries = new ObservableCollection<LibraryEntry>();
        RefreshCommand = new AsyncRelayCommand(_ => RefreshAsync());
    }

    public ObservableCollection<LibraryEntry> Entries { get; }

    public ICommand RefreshCommand { get; }

    public async Task InitializeAsync()
    {
        await RefreshAsync();
    }

    private async Task RefreshAsync()
    {
        var items = await _repository.LoadLibraryAsync(CancellationToken.None);
        Entries.Clear();
        foreach (var item in items.OrderByDescending(i => i.CreatedAt))
        {
            Entries.Add(item);
        }
    }
}
