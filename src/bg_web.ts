export function getTwitterHeaders(): Record<string, string> {
    // 获取完整的cookie
    const cookie = document.cookie;

    // 从cookie中提取x-csrf-token (ct0)
    const csrfToken = cookie.split('; ').find(c => c.startsWith('ct0='))?.split('=')[1] || '';

    // 从页面中尝试获取Bearer Token
    function findBearerToken(): string {
        const scripts = Array.from(document.querySelectorAll('script'));
        for (let script of scripts) {
            const match = script.textContent?.match(/Bearer\s+(AAAAAAAA[\w%-]+)/);
            if (match) return `Bearer ${match[1]}`;
        }
        return '';
    }

    const authorization = findBearerToken();

    return {
        'authorization': authorization,
        'x-csrf-token': csrfToken,
        'cookie': cookie,
    };
}

async function fetchKolTweets(username: string) {
    const url = `https://twitter.com/i/api/graphql/RN-6zQ2Z3HC99_kSY5eTYg/UserTweets?variables=${encodeURIComponent(JSON.stringify({
        screen_name: username,
        count: 20, // 请求推文数量
    }))}`;

    const headers = getTwitterHeaders();
    const response = await fetch(url, {
        headers: headers,
    });

    if (!response.ok) {
        console.error(`Failed to fetch tweets for ${username}`);
        return null;
    }

    const data = await response.json();
    return data;
}

export async function fetchAllKolsTweets(usernames: string[], sendResponse: (response?: any) => void) {
    try {
        const results = await Promise.all(usernames.map(name => fetchKolTweets(name)));
        const result = results.filter(result => result !== null);
        sendResponse({success: true, data: result})
    } catch (e) {
        sendResponse({success: false, data: e})
    }
}
