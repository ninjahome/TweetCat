using System.Text.Json.Serialization;

namespace TweetCat.Core.Messaging;

/// <summary>
/// Payload exchanged between the native messaging host and the desktop app via named pipes.
/// </summary>
public sealed class BridgeEnvelope
{
    [JsonPropertyName("type")]
    public string Type { get; init; } = string.Empty;

    [JsonPropertyName("payload")]
    public object? Payload { get; init; }

    public static BridgeEnvelope Create(string type, object? payload) => new()
    {
        Type = type,
        Payload = payload
    };
}
