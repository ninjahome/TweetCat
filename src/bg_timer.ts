import browser, {Runtime} from "webextension-polyfill";

const alarms = browser.alarms;
const __alarm_name__: string = '__alarm_name__timer__';

export async function createAlarm(): Promise<void> {
    const alarm = await alarms.get(__alarm_name__);
    if (!alarm) {
        alarms.create(__alarm_name__, {
            periodInMinutes: 1
        });
        console.log("------>>> alarm create success")
    }
}

alarms.onAlarm.addListener(timerTaskWork);
async function timerTaskWork(alarm: any): Promise<void> {
    if (alarm.name === __alarm_name__) {
            console.log("------>>> Alarm Triggered!");
    }
}
