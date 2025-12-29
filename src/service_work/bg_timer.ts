import browser from "webextension-polyfill";
import {__tableKolsInCategory, checkAndInitDatabase, databaseQueryAll} from "../common/database";
import {tweetFM} from "./tweet_fetch_manager";
import {checkIfXIsOpen, sendMessageToX} from "./bg_msg";
import {MsgType} from "../common/consts";
import {refillApiAccessToken, useTokenByTimer} from "./api_bucket_state";
import {logBGT} from "../common/debug_flags";

const alarms = browser.alarms;
const __alarm_tweets_fetch__: string = '__tweet__fetcher__timer__';
const __alarm_userid_check__: string = '__alarm_userid_check__';
const __interval_tweets_fetch__: number = 4;
const __interval_userID_check__: number = 5;

alarms.onAlarm.addListener(timerTaskWork);

export async function createAlarm(): Promise<void> {
    const tweetsAlarm = await alarms.get(__alarm_tweets_fetch__);
    if (!tweetsAlarm) {
        alarms.create(__alarm_tweets_fetch__, {
            periodInMinutes: __interval_tweets_fetch__
        });
        logBGT("------>>> tweetsAlarm create success", __interval_tweets_fetch__)
    }

    const userIDAlarm = await alarms.get(__alarm_userid_check__);
    if (!userIDAlarm) {
        alarms.create(__alarm_userid_check__, {
            periodInMinutes: __interval_userID_check__
        });
        logBGT("------>>> userid check alarm create success", __interval_userID_check__)
    }
}

export async function updateAlarm(): Promise<void> {
    await browser.alarms.clear(__alarm_tweets_fetch__);
    await browser.alarms.clear(__alarm_userid_check__);
    await alarms.create(__alarm_tweets_fetch__, {
        periodInMinutes: __interval_tweets_fetch__
    });
    logBGT("------>>> alarm for tweets fetch recreate success,timer:", __interval_tweets_fetch__);

    await alarms.create(__alarm_userid_check__, {
        periodInMinutes: __interval_userID_check__
    });
    logBGT("------>>> alarm for user id check recreate success,timer:", __interval_userID_check__);
}

async function timerTaskWork(alarm: any): Promise<void> {
    switch (alarm.name) {
        case __alarm_tweets_fetch__: {
            await alarmTweetsProc();
            break;
        }
        case __alarm_userid_check__: {
            await alarmUerIdCheck();
            break;
        }
        default:
            console.warn("------>>> unknown alarm name:", alarm.name);
    }
}

export async function timerKolInQueueImmediate(kolID: string): Promise<void> {
    await tweetFM.queuePush(kolID);
}

async function alarmTweetsProc() {
    logBGT("------>>> alarm triggered, start to fetch tweets from server");
    await checkAndInitDatabase();
    await refillApiAccessToken(tweetFM.MAX_KOL_PER_ROUND);
    try {
        const hasOpenXCom = await checkIfXIsOpen();
        if (!hasOpenXCom) {
            logBGT("------>>> alarm triggered , x is not open");
            return;
        }
        const canAccess = await useTokenByTimer();
        if (!canAccess) {
            logBGT("------>>> no enough api tokens, fetch tweets in next round");
            return;
        }

        await tweetFM.loadRuntimeStateFromStorage();
        await tweetFM.fetchTweetsPeriodic();
        await tweetFM.saveRuntimeStateToStorage();

    } catch (e) {
        console.error("------>>> Error in alarmTweetsProc:", e);
    }
}


async function alarmUerIdCheck() {
    await checkAndInitDatabase();
    try {
        const rows = await databaseQueryAll(__tableKolsInCategory);
        const invalid = rows.filter((r: any) => !(typeof r?.kolUserId === 'string' && r.kolUserId.trim().length > 0));
        if (invalid.length === 0) {
            logBGT("------>>> no invalid kol id to process");
            return;
        }

        await sendMessageToX(MsgType.StartKolIdCheck, invalid);
    } catch (e) {
        console.error("------>>> Error in alarmUerIdCheck:", e);
    }
}