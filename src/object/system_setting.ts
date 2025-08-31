import {sendMsgToService} from "../common/utils";
import {MsgType} from "../common/consts";
import {__tableSystemSetting, databaseAddItem, databaseUpdateFields, getMaxIdRecord} from "../common/database";

export class SystemSetting {
    id?: number;
    adsBlocked: number;
    adSwitchOn: boolean;

    constructor(ab: number, on: boolean, id?: number) {
        this.id = id;
        this.adsBlocked = ab;
        this.adSwitchOn = on;
    }
}


/**************************************************
 *
 *               service work api
 *
 * *************************************************/
export async function addBlockedAdsNumber() {
    let systemSetting = await getSystemSetting();
    await databaseUpdateFields(__tableSystemSetting, systemSetting.id!, {adsBlocked: systemSetting.adsBlocked + 1});
}

export async function switchAdOn(on: boolean) {
    let systemSetting = await getSystemSetting();
    await databaseUpdateFields(__tableSystemSetting, systemSetting.id!, {adSwitchOn: on});
}

export async function getSystemSetting(): Promise<SystemSetting> {
    let systemSetting = await getMaxIdRecord(__tableSystemSetting);
    if (!systemSetting) {
        systemSetting = new SystemSetting(0, false);
        delete systemSetting.id;
        const sysId = await databaseAddItem(__tableSystemSetting, systemSetting);
        systemSetting.id = sysId;
        return systemSetting;
    }

    return new SystemSetting(systemSetting.adsBlocked, systemSetting.adSwitchOn, systemSetting.id);
}

/**************************************************
 *
 *               content script api
 *
 * *************************************************/
export async function blockedAdNumIncrease() {
    await sendMsgToService({}, MsgType.AdsBlockSuccess);
}
