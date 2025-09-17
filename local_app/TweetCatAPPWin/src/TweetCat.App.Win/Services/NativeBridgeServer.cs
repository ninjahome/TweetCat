using System;
using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using TweetCat.Core.Messaging;
using TweetCat.Core.Models;
using TweetCat.Core.Utilities;

namespace TweetCat.App.Win.Services;

public sealed class NativeBridgeServer : IAsyncDisposable
{
    private const string PipeName = "tweetcat_win_bridge";
    private readonly CancellationTokenSource _cts = new();
    private Task? _listenerTask;
    private readonly NativeBridgeStatus _status = new();

    public event EventHandler<VideoCandidate>? MetadataReceived;
    public event EventHandler? ActivateRequested;
    public event EventHandler<NativeBridgeStatus>? StatusChanged;

    public async Task StartAsync()
    {
        if (_listenerTask != null)
        {
            return;
        }

        _listenerTask = Task.Run(ListenLoopAsync, _cts.Token);
        await Task.CompletedTask;
    }

    public NativeBridgeStatus CurrentStatus => _status;

    private async Task ListenLoopAsync()
    {
        while (!_cts.IsCancellationRequested)
        {
            using var server = new NamedPipeServerStream(PipeName, PipeDirection.InOut, NamedPipeServerStream.MaxAllowedServerInstances, PipeTransmissionMode.Byte, PipeOptions.Asynchronous);
            await server.WaitForConnectionAsync(_cts.Token);
            _status.LastPing = DateTimeOffset.UtcNow;
            RaiseStatusChanged();

            using var reader = new StreamReader(server, Encoding.UTF8, leaveOpen: true);
            while (server.IsConnected && !_cts.IsCancellationRequested)
            {
                var line = await reader.ReadLineAsync();
                if (line == null)
                {
                    break;
                }

                try
                {
                    var envelope = JsonSerializer.Deserialize<BridgeEnvelope>(line, JsonOptions.Default);
                    if (envelope == null)
                    {
                        continue;
                    }

                    HandleEnvelope(envelope);
                }
                catch (JsonException)
                {
                    // ignore malformed payloads
                }
            }
        }
    }

    private void HandleEnvelope(BridgeEnvelope envelope)
    {
        switch (envelope.Type)
        {
            case "activate":
                ActivateRequested?.Invoke(this, EventArgs.Empty);
                break;
            case "metadata":
                if (envelope.Payload is JsonElement element)
                {
                    var candidate = element.Deserialize<VideoCandidate>(JsonOptions.Default);
                    if (candidate != null)
                    {
                        MetadataReceived?.Invoke(this, candidate);
                    }
                }
                break;
            case "heartbeat":
                _status.LastPing = DateTimeOffset.UtcNow;
                if (envelope.Payload is JsonElement heartbeat && heartbeat.TryGetProperty("extensionVersion", out var version))
                {
                    _status.ExtensionVersion = version.GetString();
                }
                RaiseStatusChanged();
                break;
            case "manifest":
                if (envelope.Payload is JsonElement manifest && manifest.TryGetProperty("path", out var path))
                {
                    _status.ManifestPath = path.GetString();
                }
                RaiseStatusChanged();
                break;
        }
    }

    private void RaiseStatusChanged() => StatusChanged?.Invoke(this, _status);

    public async ValueTask DisposeAsync()
    {
        _cts.Cancel();
        if (_listenerTask != null)
        {
            try
            {
                await _listenerTask;
            }
            catch (OperationCanceledException)
            {
            }
        }
        _cts.Dispose();
    }
}

public sealed class NativeBridgeStatus
{
    public DateTimeOffset? LastPing { get; set; }
    public string? ExtensionVersion { get; set; }
    public string? ManifestPath { get; set; }
}
