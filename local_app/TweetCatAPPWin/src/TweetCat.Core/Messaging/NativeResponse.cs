using System.Text.Json.Serialization;

namespace TweetCat.Core.Messaging;

public sealed class NativeResponse
{
    [JsonPropertyName("ok")]
    public bool Ok { get; init; }

    [JsonPropertyName("message")]
    public string? Message { get; init; }

    [JsonPropertyName("data")]
    public object? Data { get; init; }

    public static NativeResponse Success(object? data = null, string? message = null) => new()
    {
        Ok = true,
        Data = data,
        Message = message
    };

    public static NativeResponse Error(string message) => new()
    {
        Ok = false,
        Message = message
    };
}
