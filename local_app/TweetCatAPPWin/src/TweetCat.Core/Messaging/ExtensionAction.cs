namespace TweetCat.Core.Messaging;

/// <summary>
/// Actions supported by the browser extension when talking to the native host.
/// </summary>
public enum ExtensionAction
{
    Start = 0,
    Cookie = 1,
    VideoMeta = 2,
    Check = 3,
    CancelDownload = 4
}
