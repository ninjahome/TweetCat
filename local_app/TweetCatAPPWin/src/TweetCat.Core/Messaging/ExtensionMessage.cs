using System.Text.Json;
using System.Text.Json.Serialization;

namespace TweetCat.Core.Messaging;

/// <summary>
/// Message envelope exchanged with the Chromium extension.
/// </summary>
public sealed class ExtensionMessage
{
    [JsonPropertyName("action")]
    public ExtensionAction Action { get; init; }

    [JsonPropertyName("payload")]
    public JsonElement Payload { get; init; }

    public static ExtensionMessage Create(ExtensionAction action, object? payload = null)
    {
        var element = payload is null
            ? JsonDocument.Parse("{}").RootElement
            : JsonSerializer.SerializeToElement(payload);
        return new ExtensionMessage { Action = action, Payload = element };
    }
}
