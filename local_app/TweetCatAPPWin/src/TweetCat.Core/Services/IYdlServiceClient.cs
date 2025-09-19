using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using TweetCat.Core.Models;

namespace TweetCat.Core.Services;

public interface IYdlServiceClient : IAsyncDisposable
{
    Task InitializeAsync(CancellationToken cancellationToken = default);

    Task<IReadOnlyList<VideoCandidate>> QueryMetadataAsync(string url, CancellationToken cancellationToken = default);

    Task<string> EnqueueDownloadAsync(VideoCandidate candidate, YtdlpFormat format, CancellationToken cancellationToken = default);

    Task CancelAsync(string taskId, CancellationToken cancellationToken = default);

    IAsyncEnumerable<DownloadTaskState> WatchProgressAsync(CancellationToken cancellationToken = default);
}
