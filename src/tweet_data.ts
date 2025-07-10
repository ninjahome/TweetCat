
let tweetData: any[] = [];
let currentIdx = 0;

export async function initTweetPager() {
    if (tweetData.length === 0) {
        const { fetchTweets } = await import("./tweet_api");
        const {tweets} = await fetchTweets("1315345422123180033", 20);
        tweetData = tweets;
        currentIdx = 0;
    }
}

export function getNextTweets(pageSize: number): any[] {
    if (!tweetData.length) return [];
    const result: any[] = [];
    for (let i = 0; i < pageSize; i++) {
        result.push(tweetData[(currentIdx + i) % tweetData.length]);
    }
    currentIdx = (currentIdx + pageSize) % tweetData.length;
    return result;
}

export function resetTweetPager() {
    currentIdx = 0;
}