using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Sockets;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Channels;
using System.Threading.Tasks;
using TweetCat.Core.Models;
using TweetCat.Core.Services;
using TweetCat.Core.Utilities;

namespace TweetCat.App.Win.Services;

public sealed class YdlServiceClient : IYdlServiceClient
{
    private const int ControlPort = 54320;
    private const int StreamPort = 54321;

    private readonly string _resourceRoot;
    private readonly Channel<DownloadTaskState> _progressChannel = Channel.CreateUnbounded<DownloadTaskState>();
    private readonly CancellationTokenSource _cts = new();
    private Process? _process;
    private Task? _progressTask;

    public YdlServiceClient(string resourceRoot)
    {
        _resourceRoot = resourceRoot;
    }

    public async Task InitializeAsync(CancellationToken cancellationToken = default)
    {
        var executable = Directory.EnumerateFiles(_resourceRoot, "tweetcat_ydl_server*", SearchOption.TopDirectoryOnly)
            .FirstOrDefault();

        if (executable == null)
        {
            throw new FileNotFoundException("未找到 tweetcat_ydl_server 可执行文件", _resourceRoot);
        }

        var startInfo = new ProcessStartInfo(executable)
        {
            WorkingDirectory = _resourceRoot,
            UseShellExecute = false,
            CreateNoWindow = true
        };

        _process = Process.Start(startInfo) ?? throw new InvalidOperationException("无法启动 tweetcat_ydl_server");

        await WaitForPortAsync(ControlPort, cancellationToken);
        await SendControlAsync(new { action = "version" }, cancellationToken);
        _progressTask = Task.Run(() => ListenProgressAsync(_cts.Token), _cts.Token);
    }

    public async Task<IReadOnlyList<VideoCandidate>> QueryMetadataAsync(string url, CancellationToken cancellationToken = default)
    {
        var payload = new { action = "metadata", url };
        var response = await SendControlAsync(payload, cancellationToken);
        if (response is JsonElement element && element.TryGetProperty("videos", out var videos))
        {
            return videos.Deserialize<List<VideoCandidate>>(JsonOptions.Default) ?? new List<VideoCandidate>();
        }

        return Array.Empty<VideoCandidate>();
    }

    public async Task<string> EnqueueDownloadAsync(VideoCandidate candidate, YtdlpFormat format, CancellationToken cancellationToken = default)
    {
        var payload = new
        {
            action = "download",
            videoId = candidate.VideoId,
            format = format.Id,
            preferredExt = format.Extension,
            title = candidate.Title
        };
        var response = await SendControlAsync(payload, cancellationToken);
        if (response is JsonElement element && element.TryGetProperty("taskId", out var taskId))
        {
            return taskId.GetString() ?? Guid.NewGuid().ToString();
        }

        return Guid.NewGuid().ToString();
    }

    public Task CancelAsync(string taskId, CancellationToken cancellationToken = default)
    {
        var payload = new { action = "cancel", taskId };
        return SendControlAsync(payload, cancellationToken);
    }

    public async IAsyncEnumerable<DownloadTaskState> WatchProgressAsync([EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        while (await _progressChannel.Reader.WaitToReadAsync(cancellationToken))
        {
            while (_progressChannel.Reader.TryRead(out var item))
            {
                yield return item;
            }
        }
    }

    public async ValueTask DisposeAsync()
    {
        _cts.Cancel();
        if (_progressTask != null)
        {
            try
            {
                await _progressTask;
            }
            catch (OperationCanceledException)
            {
            }
        }

        if (_process is { HasExited: false })
        {
            _process.Kill(entireProcessTree: true);
        }

        _process?.Dispose();
        _cts.Dispose();
    }

    private static async Task WaitForPortAsync(int port, CancellationToken cancellationToken)
    {
        var timeout = DateTimeOffset.UtcNow.AddSeconds(20);
        while (DateTimeOffset.UtcNow < timeout)
        {
            try
            {
                using var client = new TcpClient();
                await client.ConnectAsync("127.0.0.1", port, cancellationToken);
                return;
            }
            catch
            {
                await Task.Delay(500, cancellationToken);
            }
        }

        throw new TimeoutException($"等待端口 {port} 超时");
    }

    private async Task<object?> SendControlAsync(object payload, CancellationToken cancellationToken)
    {
        using var client = new TcpClient();
        await client.ConnectAsync("127.0.0.1", ControlPort, cancellationToken);
        await using var stream = client.GetStream();
        await JsonSerializer.SerializeAsync(stream, payload, JsonOptions.Default, cancellationToken);
        await stream.WriteAsync(Encoding.UTF8.GetBytes("\n"), cancellationToken);
        await stream.FlushAsync(cancellationToken);

        using var reader = new StreamReader(stream, Encoding.UTF8, leaveOpen: true);
        var responseText = await reader.ReadLineAsync(cancellationToken);
        if (responseText == null)
        {
            return null;
        }

        return JsonSerializer.Deserialize<JsonElement>(responseText);
    }

    private async Task ListenProgressAsync(CancellationToken cancellationToken)
    {
        using var client = new TcpClient();
        await client.ConnectAsync("127.0.0.1", StreamPort, cancellationToken);
        using var reader = new StreamReader(client.GetStream(), Encoding.UTF8);
        while (!cancellationToken.IsCancellationRequested)
        {
            var line = await reader.ReadLineAsync();
            if (line == null)
            {
                break;
            }

            try
            {
                var state = JsonSerializer.Deserialize<DownloadTaskState>(line, JsonOptions.Default);
                if (state != null)
                {
                    await _progressChannel.Writer.WriteAsync(state, cancellationToken);
                }
            }
            catch (JsonException)
            {
                // ignore invalid rows
            }
        }
    }
}
