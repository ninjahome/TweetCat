using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace TweetCat.Core.Models;

public sealed class VideoCandidate
{
    [JsonPropertyName("videoId")]
    public string VideoId { get; init; } = string.Empty;

    [JsonPropertyName("title")]
    public string Title { get; init; } = string.Empty;

    [JsonPropertyName("author")]
    public string Author { get; init; } = string.Empty;

    [JsonPropertyName("durationSeconds")]
    public double DurationSeconds { get; init; }

    [JsonPropertyName("thumbnails")]
    public IReadOnlyList<string> Thumbnails { get; init; } = Array.Empty<string>();

    [JsonPropertyName("formats")]
    public IReadOnlyList<YtdlpFormat> Formats { get; init; } = Array.Empty<YtdlpFormat>();
}

public sealed class YtdlpFormat
{
    [JsonPropertyName("id")]
    public string Id { get; init; } = string.Empty;

    [JsonPropertyName("ext")]
    public string Extension { get; init; } = string.Empty;

    [JsonPropertyName("resolution")]
    public string? Resolution { get; init; }

    [JsonPropertyName("fps")]
    public double? Fps { get; init; }

    [JsonPropertyName("filesize")]
    public long? FileSize { get; init; }
}
