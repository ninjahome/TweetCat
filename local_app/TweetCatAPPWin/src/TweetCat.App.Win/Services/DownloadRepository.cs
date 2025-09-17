using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using TweetCat.Core.Models;
using TweetCat.Core.Services;
using TweetCat.Core.Utilities;

namespace TweetCat.App.Win.Services;

public sealed class DownloadRepository : IDownloadRepository
{
    private readonly string _root;
    private readonly SemaphoreSlim _mutex = new(1, 1);
    private readonly string _activePath;
    private readonly string _libraryPath;

    public DownloadRepository(string root)
    {
        _root = root;
        Directory.CreateDirectory(_root);
        _activePath = Path.Combine(_root, "active_tasks.json");
        _libraryPath = Path.Combine(_root, "library.json");
    }

    public string RootPath => _root;

    public async Task<IReadOnlyList<DownloadTaskState>> LoadActiveAsync(CancellationToken cancellationToken = default)
    {
        await _mutex.WaitAsync(cancellationToken);
        try
        {
            if (!File.Exists(_activePath))
            {
                return Array.Empty<DownloadTaskState>();
            }

            await using var stream = File.OpenRead(_activePath);
            var data = await JsonSerializer.DeserializeAsync<List<DownloadTaskState>>(stream, JsonOptions.Default, cancellationToken);
            return data ?? new List<DownloadTaskState>();
        }
        finally
        {
            _mutex.Release();
        }
    }

    public async Task SaveActiveAsync(IEnumerable<DownloadTaskState> tasks, CancellationToken cancellationToken = default)
    {
        await _mutex.WaitAsync(cancellationToken);
        try
        {
            await using var stream = File.Create(_activePath);
            await JsonSerializer.SerializeAsync(stream, tasks, JsonOptions.Default, cancellationToken);
        }
        finally
        {
            _mutex.Release();
        }
    }

    public async Task<IReadOnlyList<LibraryEntry>> LoadLibraryAsync(CancellationToken cancellationToken = default)
    {
        await _mutex.WaitAsync(cancellationToken);
        try
        {
            if (!File.Exists(_libraryPath))
            {
                return Array.Empty<LibraryEntry>();
            }

            await using var stream = File.OpenRead(_libraryPath);
            var data = await JsonSerializer.DeserializeAsync<List<LibraryEntry>>(stream, JsonOptions.Default, cancellationToken);
            return data ?? new List<LibraryEntry>();
        }
        finally
        {
            _mutex.Release();
        }
    }

    public async Task SaveLibraryAsync(IEnumerable<LibraryEntry> entries, CancellationToken cancellationToken = default)
    {
        await _mutex.WaitAsync(cancellationToken);
        try
        {
            await using var stream = File.Create(_libraryPath);
            await JsonSerializer.SerializeAsync(stream, entries, JsonOptions.Default, cancellationToken);
        }
        finally
        {
            _mutex.Release();
        }
    }

    public async Task AddToLibraryAsync(LibraryEntry entry, CancellationToken cancellationToken = default)
    {
        await _mutex.WaitAsync(cancellationToken);
        try
        {
            List<LibraryEntry> entries;
            if (File.Exists(_libraryPath))
            {
                await using var readStream = File.OpenRead(_libraryPath);
                entries = await JsonSerializer.DeserializeAsync<List<LibraryEntry>>(readStream, JsonOptions.Default, cancellationToken) ?? new();
            }
            else
            {
                entries = new List<LibraryEntry>();
            }

            var existing = entries.FirstOrDefault(e => e.Id == entry.Id);
            if (existing != null)
            {
                entries.Remove(existing);
            }

            entries.Add(entry);

            await using var writeStream = File.Create(_libraryPath);
            await JsonSerializer.SerializeAsync(writeStream, entries, JsonOptions.Default, cancellationToken);
        }
        finally
        {
            _mutex.Release();
        }
    }
}
