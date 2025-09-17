using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using TweetCat.Core.Models;

namespace TweetCat.Core.Services;

public interface IDownloadRepository
{
    Task<IReadOnlyList<DownloadTaskState>> LoadActiveAsync(CancellationToken cancellationToken = default);

    Task SaveActiveAsync(IEnumerable<DownloadTaskState> tasks, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<LibraryEntry>> LoadLibraryAsync(CancellationToken cancellationToken = default);

    Task SaveLibraryAsync(IEnumerable<LibraryEntry> entries, CancellationToken cancellationToken = default);

    Task AddToLibraryAsync(LibraryEntry entry, CancellationToken cancellationToken = default);
}
