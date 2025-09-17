using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

namespace TweetCat.Core.Services;

public interface ICookieStorage
{
    Task<string> PersistCookiesAsync(IEnumerable<BrowserCookie> cookies, CancellationToken cancellationToken = default);
}

public sealed record BrowserCookie(
    string Domain,
    string Path,
    bool Secure,
    DateTimeOffset Expires,
    string Name,
    string Value);
