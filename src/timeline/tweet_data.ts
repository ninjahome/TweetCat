import {EntryObj} from "./tweet_obj";
import {fetchTweets, getUserIdByUsername} from "./twitter_api";

let tweetData: any[] = [];
let currentIdx = 0;

export async function initTweetPager() {
    if (tweetData.length === 0) {
        // console.log("------>>>user id:", await getUserIdByUsername('xingyun09039849'));
        const {tweets, nextCursor, isEnd} = await fetchTweets("1315345422123180033", 20);//1861626580579360768//1315345422123180033
        tweetData = tweets;
        if (nextCursor) {
            const {tweets} = await fetchTweets("1861626580579360768", 20, nextCursor);
            tweetData.push(...tweets);
        }
        console.log("------->>> tweet length:", tweetData.length);
        currentIdx = 0;
    }
}

export function getNextTweets(pageSize: number): EntryObj[] {
    if (!tweetData.length) return [];
    const result: EntryObj[] = [];
    for (let i = 0; i < pageSize; i++) {
        result.push(tweetData[(currentIdx + i) % tweetData.length]);
    }
    currentIdx = (currentIdx + pageSize) % tweetData.length;
    return result;
}

export function resetTweetPager() {
    currentIdx = 0;
    tweetData.length = 0;
}