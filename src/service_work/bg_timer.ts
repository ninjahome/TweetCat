import browser from "webextension-polyfill";
import {checkAndInitDatabase} from "../common/database";
import {tweetFetcher} from "./tweet_fetcher";

const alarms = browser.alarms;
const __alarm_name__: string = '__tweet__fetcher__timer__';

export async function createAlarm(): Promise<void> {
    const alarm = await alarms.get(__alarm_name__);
    if (!alarm) {
        alarms.create(__alarm_name__, {
            periodInMinutes: 1
        });
        console.log("------>>> alarm create success")
    }
}

let isRunning = false;
alarms.onAlarm.addListener(timerTaskWork);

async function timerTaskWork(alarm: any): Promise<void> {
    if (alarm.name === __alarm_name__) {
        if (isRunning) return;
        isRunning = true;
        try {
            console.log("------>>> Alarm Triggered!");
            await checkAndInitDatabase(); // 确保数据库就绪
            await tweetFetcher.fetchTweetsPeriodic(); // 你的核心抓取逻辑
        } finally {
            isRunning = false;
        }

    }
}
