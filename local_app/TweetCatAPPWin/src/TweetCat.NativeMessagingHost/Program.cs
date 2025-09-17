using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using TweetCat.Core.Messaging;
using TweetCat.Core.Models;
using TweetCat.Core.Services;
using TweetCat.Core.Utilities;

namespace TweetCat.NativeMessagingHost;

internal static class Program
{
    private static async Task Main()
    {
        var app = new NativeHostApp();
        await app.RunAsync();
    }
}

internal sealed class NativeHostApp
{
    private readonly Stream _stdin = Console.OpenStandardInput();
    private readonly Stream _stdout = Console.OpenStandardOutput();
    private readonly JsonSerializerOptions _options = JsonOptions.Default;
    private readonly CookieStorage _cookieStorage;
    private Process? _uiProcess;

    public NativeHostApp()
    {
        var appDataRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "TweetCat");
        _cookieStorage = new CookieStorage(appDataRoot);
    }

    public async Task RunAsync()
    {
        while (true)
        {
            var message = await ReadMessageAsync(_stdin, _options);
            if (message == null)
            {
                return;
            }

            var response = await HandleMessageAsync(message);
            await WriteMessageAsync(_stdout, response, _options);
        }
    }

    private async Task<NativeResponse> HandleMessageAsync(ExtensionMessage message)
    {
        switch (message.Action)
        {
            case ExtensionAction.Start:
                await EnsureUiRunningAsync();
                await NotifyBridgeAsync("activate", new { });
                return NativeResponse.Success(new { started = true });
            case ExtensionAction.Cookie:
                var cookies = ParseCookies(message.Payload);
                var path = await _cookieStorage.PersistCookiesAsync(cookies);
                await NotifyBridgeAsync("cookie", new { path });
                return NativeResponse.Success(new { path });
            case ExtensionAction.VideoMeta:
                var candidate = message.Payload.Deserialize<VideoCandidate>(_options);
                if (candidate != null)
                {
                    await NotifyBridgeAsync("metadata", candidate);
                }
                return NativeResponse.Success();
            case ExtensionAction.Check:
                return NativeResponse.Success(new
                {
                    version = "1.0.0",
                    manifestPath = Path.Combine(AppContext.BaseDirectory, "..", "packaging", "native-messaging-manifest.json")
                });
            case ExtensionAction.CancelDownload:
                if (message.Payload.TryGetProperty("taskId", out var taskId))
                {
                    await NotifyBridgeAsync("cancel", new { taskId = taskId.GetString() });
                }
                return NativeResponse.Success();
            default:
                return NativeResponse.Error($"Unknown action: {message.Action}");
        }
    }

    private async Task EnsureUiRunningAsync()
    {
        if (_uiProcess is { HasExited: false })
        {
            return;
        }

        var uiPath = ResolveUiExecutable();
        if (uiPath == null)
        {
            throw new InvalidOperationException("无法定位 TweetCat.App.Win.exe");
        }

        var startInfo = new ProcessStartInfo
        {
            FileName = uiPath,
            UseShellExecute = true
        };
        _uiProcess = Process.Start(startInfo);
        await Task.Delay(500);
    }

    private static string? ResolveUiExecutable()
    {
        var baseDir = AppContext.BaseDirectory;
        var candidates = new[]
        {
            Path.Combine(baseDir, "..", "TweetCat.App.Win", "TweetCat.App.Win.exe"),
            Path.Combine(baseDir, "TweetCat.App.Win.exe")
        };

        return candidates
            .Select(Path.GetFullPath)
            .FirstOrDefault(File.Exists);
    }

    private static async Task<ExtensionMessage?> ReadMessageAsync(Stream stream, JsonSerializerOptions options)
    {
        var lengthBuffer = new byte[4];
        var read = await stream.ReadAsync(lengthBuffer.AsMemory(0, 4));
        if (read == 0)
        {
            return null;
        }

        if (read != 4)
        {
            throw new InvalidOperationException("无法读取消息长度");
        }

        var length = BitConverter.ToInt32(lengthBuffer, 0);
        var payloadBuffer = new byte[length];
        await stream.ReadExactlyAsync(payloadBuffer.AsMemory(0, length));
        var json = Encoding.UTF8.GetString(payloadBuffer);
        return JsonSerializer.Deserialize<ExtensionMessage>(json, options);
    }

    private static async Task WriteMessageAsync(Stream stream, NativeResponse response, JsonSerializerOptions options)
    {
        var json = JsonSerializer.Serialize(response, options);
        var data = Encoding.UTF8.GetBytes(json);
        var length = BitConverter.GetBytes(data.Length);
        await stream.WriteAsync(length, 0, length.Length);
        await stream.WriteAsync(data, 0, data.Length);
        await stream.FlushAsync();
    }

    private static IEnumerable<BrowserCookie> ParseCookies(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<BrowserCookie>();
        }

        var list = new List<BrowserCookie>();
        foreach (var item in element.EnumerateArray())
        {
            var cookie = new BrowserCookie(
                Domain: item.GetPropertyOrDefault("domain", string.Empty),
                Path: item.GetPropertyOrDefault("path", "/"),
                Secure: item.GetPropertyOrDefault("secure", false),
                Expires: DateTimeOffset.FromUnixTimeSeconds(item.GetPropertyOrDefault("expires", 0L)),
                Name: item.GetPropertyOrDefault("name", string.Empty),
                Value: item.GetPropertyOrDefault("value", string.Empty));
            list.Add(cookie);
        }

        return list;
    }

    private static async Task NotifyBridgeAsync(string type, object payload)
    {
        try
        {
            using var client = new NamedPipeClientStream(".", "tweetcat_win_bridge", PipeDirection.Out);
            await client.ConnectAsync(200);
            await using var writer = new StreamWriter(client, Encoding.UTF8) { AutoFlush = true };
            var envelope = BridgeEnvelope.Create(type, payload);
            var json = JsonSerializer.Serialize(envelope, JsonOptions.Default);
            await writer.WriteLineAsync(json);
        }
        catch
        {
            // bridge not available, ignore
        }
    }
}

internal static class JsonElementExtensions
{
    public static T GetPropertyOrDefault<T>(this JsonElement element, string propertyName, T defaultValue)
    {
        if (!element.TryGetProperty(propertyName, out var property))
        {
            return defaultValue;
        }

        try
        {
            return property.Deserialize<T>(new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? defaultValue;
        }
        catch
        {
            return defaultValue;
        }
    }
}

internal sealed class CookieStorage : ICookieStorage
{
    private readonly string _root;

    public CookieStorage(string root)
    {
        _root = root;
    }

    public async Task<string> PersistCookiesAsync(IEnumerable<BrowserCookie> cookies, CancellationToken cancellationToken = default)
    {
        Directory.CreateDirectory(_root);
        var path = Path.Combine(_root, "cookies.txt");
        var content = NetscapeCookieWriter.WriteToString(cookies);
        await File.WriteAllTextAsync(path, content, cancellationToken);
        return path;
    }
}
