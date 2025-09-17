using System.Collections.Generic;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using TweetCat.Core.Services;
using TweetCat.Core.Utilities;

namespace TweetCat.App.Win.Services;

public sealed class CookieStorage : ICookieStorage
{
    private readonly string _cookieFile;

    public CookieStorage(string root)
    {
        Directory.CreateDirectory(root);
        _cookieFile = Path.Combine(root, "cookies.txt");
    }

    public async Task<string> PersistCookiesAsync(IEnumerable<BrowserCookie> cookies, CancellationToken cancellationToken = default)
    {
        var content = NetscapeCookieWriter.WriteToString(cookies);
        await File.WriteAllTextAsync(_cookieFile, content, cancellationToken);
        return _cookieFile;
    }
}
