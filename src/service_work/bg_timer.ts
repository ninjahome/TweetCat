import browser from "webextension-polyfill";
import {checkAndInitDatabase} from "../common/database";
import {checkIfXIsOpen, TweetFetcherManager} from "./tweet_fetch_manager";

const alarms = browser.alarms;
const __alarm_tweets_fetch__: string = '__tweet__fetcher__timer__';
const __interval_tweets_fetch__: number = 2;
const tweetFM = new TweetFetcherManager();

alarms.onAlarm.addListener(timerTaskWork);

export async function createAlarm(): Promise<void> {
    const alarm = await alarms.get(__alarm_tweets_fetch__);
    if (!alarm) {
        alarms.create(__alarm_tweets_fetch__, {
            periodInMinutes: __interval_tweets_fetch__
        });
        console.log("------>>> alarm create success", __interval_tweets_fetch__)
    }
}

export async function updateAlarm(): Promise<void> {
    await browser.alarms.clear(__alarm_tweets_fetch__);
    alarms.create(__alarm_tweets_fetch__, {
        periodInMinutes: __interval_tweets_fetch__
    });
    console.log("------>>> alarm recreate success,timer:", __interval_tweets_fetch__);
}

export async function setTweetBootStrap() {
    await tweetFM.resetState();
    await alarmTweetsProc();
}

async function timerTaskWork(alarm: any): Promise<void> {
    switch (alarm.name) {
        case __alarm_tweets_fetch__: {
            await alarmTweetsProc();
            break;
        }
        default:
            console.log("------>>> unknown alarm name:", alarm.name);
    }
}

async function alarmTweetsProc() {
    await checkAndInitDatabase();
    try {
        const hasOpenXCom = await checkIfXIsOpen();
        if (!hasOpenXCom) {
            console.log("------>>> alarm triggered , x is not open");
            return;
        }

        await tweetFM.loadRuntimeStateFromStorage();
        console.log("------>>> alarm triggered, start to notify content script");
        await tweetFM.fetchTweetsPeriodic();
        await tweetFM.saveRuntimeStateToStorage();
    } catch (e) {
        console.error("------>>> Error in alarmTweetsProc:", e);
    }
}


